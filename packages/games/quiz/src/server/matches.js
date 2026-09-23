import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError, parse, transaction, hashToken, verifyToken } from "@quizarena/database";
import { QUIZ_GAME_KEY } from "./legacy-compat.js";
import { quizParticipantRepository } from "./participants-repository.js";
import { calculatePoints, isResponseWithinDeadline } from "./scoring.js";
import { snapshotFromQuiz, validateSnapshot, participantDTO } from "./snapshot.js";

const idSchema = z.uuid();
const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/);
const displayNameSchema = z.string().normalize("NFKC").trim().min(2).max(24).refine((value) => !Array.from(value).some((character) => { const code = character.codePointAt(0); return code <= 31 || (code >= 127 && code <= 159); }), "INVALID_NAME");
const createSessionSchema = z.object({ roomCode: z.unknown(), snapshot: z.unknown(), hostToken: z.unknown() }).strict();
const participantInputSchema = z.object({ gameSessionId: idSchema, displayName: z.unknown(), reconnectToken: z.unknown() }).strict();
const decisionSchema = z.object({ gameSessionId: idSchema, participantId: idSchema, questionRef: idSchema, selectedOptionRef: idSchema, isCorrect: z.boolean(), responseTimeMs: z.number().int().min(0).max(2147483647), pointsAwarded: z.number().int().min(0).max(2147483647) }).strict();
const matchAnswerSchema = z.object({ gameSessionId: idSchema, participantId: idSchema, questionRef: idSchema, selectedOptionRef: idSchema }).strict();
const include = { participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } };
const quizWithQuestions = { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } };

// The Quiz match service: every Quiz-specific transition of a match (start,
// answer, result, next question, finish), its participants and its legacy
// hosted-room flow. Generic match facts (status, dates, occupancy) go through
// the platform services; Quiz snapshot/progress through QuizMatchState.
export function createQuizMatchService({ client, platform, states, maxPlayers = 20 }) {
  const participantsOf = (db) => quizParticipantRepository(db, platform.participants);
  const sessionDTO = (view) => (view ? { ...structuredClone(view), participants: view.participants.map(participantDTO) } : null);
  async function rowOf(db, id) {
    const row = await db.gameSession.findUnique({ where: { id: parse(idSchema, id, "SESSION_INVALID") }, include });
    if (!row || row.gameKey !== QUIZ_GAME_KEY) throw new DomainError("SESSION_NOT_FOUND");
    return row;
  }
  // This service runs Quiz matches only; another game's match is not its business.
  const requireView = async (db, id) => states.view(db, await rowOf(db, id));

  async function finishState(tx, id) {
    await states.update(tx, id, { matchPhase: "FINISHED", questionStartedAt: null, questionEndsAt: null });
    await platform.matches.finish(tx, id);
  }
  async function createHosted(tx, { roomCode, quizId, snapshot, hostTokenHash, hostUserId, visibility }) {
    const match = await tx.gameSession.create({ data: { roomCode, gameKey: QUIZ_GAME_KEY, hostTokenHash, ...(hostUserId ? { hostUserId } : {}), ...(visibility ? { visibility } : {}), ...states.compatColumns(quizId, snapshot) } });
    await states.create(tx, { matchId: match.id, quizId, snapshot });
    return sessionDTO(await requireView(tx, match.id));
  }

  return {
    async startMatch(id) {
      return transaction(client, async (tx) => {
        const session = await requireView(tx, id);
        if (session.matchPhase !== "LOBBY") throw new DomainError("INVALID_STATE");
        if (!(await participantsOf(tx).activeCount(id))) throw new DomainError("NO_PARTICIPANTS");
        const snapshot = session.quizSnapshot;
        if (!snapshot.questions.length) throw new DomainError("NO_QUESTIONS");
        const now = new Date();
        await platform.matches.activate(tx, id);
        await states.update(tx, id, { matchPhase: "QUESTION", currentQuestionIndex: 0, questionStartedAt: now, questionEndsAt: new Date(now.getTime() + snapshot.questions[0].durationSeconds * 1000) });
        return sessionDTO(await requireView(tx, id));
      });
    },
    async answer(input) {
      const parsed = parse(matchAnswerSchema, input, "INVALID_ANSWER");
      return transaction(client, async (tx) => {
        const repo = participantsOf(tx);
        const session = await requireView(tx, parsed.gameSessionId);
        if (session.matchPhase !== "QUESTION" || session.status !== "ACTIVE") throw new DomainError("INVALID_STATE");
        const now = new Date();
        if (!session.questionEndsAt || !isResponseWithinDeadline(now, session.questionEndsAt)) throw new DomainError("QUESTION_EXPIRED");
        const participant = await repo.get(parsed.participantId, parsed.gameSessionId);
        if (!participant || participant.disconnectedAt) throw new DomainError("PARTICIPANT_NOT_ACTIVE");
        const question = session.quizSnapshot.questions[session.currentQuestionIndex];
        if (!question || question.id !== parsed.questionRef) throw new DomainError("INVALID_ANSWER");
        const option = question.options.find((candidate) => candidate.id === parsed.selectedOptionRef);
        if (!option) throw new DomainError("INVALID_ANSWER");
        const existing = await repo.answersForQuestion(parsed.gameSessionId, parsed.questionRef);
        if (existing.some((answer) => answer.participantId === parsed.participantId)) throw new DomainError("ANSWER_ALREADY_SUBMITTED");
        const responseTimeMs = Math.max(0, now.getTime() - session.questionStartedAt.getTime());
        const pointsAwarded = calculatePoints({ basePoints: question.basePoints, responseTimeMs, durationMs: question.durationSeconds * 1000, isCorrect: option.isCorrect });
        await repo.answer({ gameSessionId: parsed.gameSessionId, participantId: parsed.participantId, questionRef: parsed.questionRef, selectedOptionRef: parsed.selectedOptionRef, isCorrect: option.isCorrect, responseTimeMs, pointsAwarded });
        await repo.addScore(parsed.participantId, parsed.gameSessionId, pointsAwarded, now);
        return { answeredAt: now, isCorrect: option.isCorrect, pointsAwarded, responseTimeMs };
      }, "ANSWER_ALREADY_SUBMITTED");
    },
    async questionResult(id) {
      return transaction(client, async (tx) => {
        const session = await requireView(tx, id);
        if (session.matchPhase !== "QUESTION") throw new DomainError("INVALID_STATE");
        const question = session.quizSnapshot.questions[session.currentQuestionIndex];
        const repo = participantsOf(tx);
        const answers = await repo.answersForQuestion(id, question.id);
        await states.update(tx, id, { matchPhase: "QUESTION_RESULT" });
        return { session: sessionDTO(await requireView(tx, id)), question: { id: question.id, correctOptionId: question.options.find((option) => option.isCorrect).id, round: session.currentQuestionIndex + 1 }, answers, ranking: await repo.ranking(id) };
      });
    },
    async nextQuestion(id) {
      return transaction(client, async (tx) => {
        const session = await requireView(tx, id);
        if (session.matchPhase !== "QUESTION_RESULT") throw new DomainError("INVALID_STATE");
        const nextIndex = session.currentQuestionIndex + 1;
        if (nextIndex >= session.quizSnapshot.questions.length) {
          await finishState(tx, id);
          return { finished: true, session: sessionDTO(await requireView(tx, id)), ranking: await participantsOf(tx).ranking(id) };
        }
        const now = new Date();
        await states.update(tx, id, { matchPhase: "QUESTION", currentQuestionIndex: nextIndex, questionStartedAt: now, questionEndsAt: new Date(now.getTime() + session.quizSnapshot.questions[nextIndex].durationSeconds * 1000) });
        return { finished: false, session: sessionDTO(await requireView(tx, id)) };
      });
    },
    async currentQuestion(id) {
      const session = await requireView(client, id);
      const question = session.currentQuestionIndex == null ? null : session.quizSnapshot.questions[session.currentQuestionIndex];
      return { session, question, answers: question ? await participantsOf(client).answersForQuestion(id, question.id) : [] };
    },
    // Legacy hosted flow (kept for compatibility and its tests).
    async create(input) {
      const { roomCode, snapshot, hostToken } = parse(createSessionSchema, input, "SESSION_INVALID");
      const validated = validateSnapshot(snapshot);
      const code = parse(roomCodeSchema, roomCode, "ROOM_CODE_INVALID");
      const hostTokenHash = await hashToken(hostToken);
      return transaction(client, async (tx) => {
        const quiz = await tx.quiz.findUnique({ where: { id: validated.quizId } });
        if (!quiz) throw new DomainError("QUIZ_NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        return createHosted(tx, { roomCode: code, quizId: validated.quizId, snapshot: validated, hostTokenHash });
      }, "ROOM_CODE_CONFLICT");
    },
    async createOwnedRoom(ownerId, quizId, roomCode, hostToken) {
      const hostTokenHash = await hashToken(hostToken);
      return transaction(client, async (tx) => {
        const quiz = await tx.quiz.findFirst({ where: { id: quizId, ownerId }, include: quizWithQuestions });
        if (!quiz) throw new DomainError("NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        return createHosted(tx, { roomCode, quizId, snapshot: snapshotFromQuiz(quiz), hostTokenHash });
      }, "ROOM_CODE_CONFLICT");
    },
    async createRoomFromPublished(quizId, roomCode, hostToken, { hostUserId, visibility = "PUBLIC" } = {}) {
      const hostTokenHash = await hashToken(hostToken);
      return transaction(client, async (tx) => {
        const quiz = await tx.quiz.findUnique({ where: { id: quizId }, include: quizWithQuestions });
        if (!quiz) throw new DomainError("NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        return createHosted(tx, { roomCode, quizId, snapshot: snapshotFromQuiz(quiz), hostTokenHash, hostUserId, visibility });
      }, "ROOM_CODE_CONFLICT");
    },
    async getById(id) {
      return sessionDTO(await requireView(client, id));
    },
    async getByCode(code) {
      const row = await client.gameSession.findUnique({ where: { roomCode: parse(roomCodeSchema, code, "ROOM_CODE_INVALID") }, include });
      return row && row.gameKey === QUIZ_GAME_KEY ? sessionDTO(await states.view(client, row)) : null;
    },
    async publicRoomsForQuiz(quizId) {
      const rows = await client.gameSession.findMany({
        where: { gameKey: QUIZ_GAME_KEY, visibility: "PUBLIC", status: "WAITING", quizState: { is: { quizId: parse(idSchema, quizId, "QUIZ_INVALID") } } },
        include: { host: { select: { name: true } }, quizState: { select: { quizId: true } }, _count: { select: { participants: { where: { disconnectedAt: null } } } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({ roomCode: row.roomCode, quizId: row.quizState.quizId, hostName: row.host?.name ?? null, playerCount: row._count.participants, maxPlayers, status: row.status, createdAt: row.createdAt, canJoin: row._count.participants < maxPlayers }));
    },
    async resumePresenceForAccount(gameSessionId, userId) {
      const ids = { gameSessionId: parse(idSchema, gameSessionId, "SESSION_INVALID"), userId: parse(idSchema, userId, "PARTICIPANT_INVALID") };
      return transaction(client, async (tx) => {
        const repo = participantsOf(tx);
        const row = await repo.byUser(ids.gameSessionId, ids.userId);
        if (!row) return null;
        return participantDTO(await repo.updatePresence(row.id, ids.gameSessionId, true));
      });
    },
    async enterAsAccount({ gameSessionId, userId, displayName }) {
      const ids = parse(z.object({ gameSessionId: idSchema, userId: idSchema }).strict(), { gameSessionId, userId }, "PARTICIPANT_INVALID");
      return transaction(client, async (tx) => {
        const repo = participantsOf(tx);
        const session = await rowOf(tx, ids.gameSessionId);
        const existing = await repo.byUser(ids.gameSessionId, ids.userId);
        if (existing) return { participant: participantDTO(await repo.updatePresence(existing.id, ids.gameSessionId, true)), created: false };
        if (session.status !== "WAITING") throw new DomainError("SESSION_NOT_WAITING");
        if (await repo.count(ids.gameSessionId) >= maxPlayers) throw new DomainError("ROOM_FULL");
        const name = parse(displayNameSchema, displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
        const reconnectTokenHash = await hashToken(randomBytes(32).toString("hex"));
        const created = await repo.add({ gameSessionId: ids.gameSessionId, userId: ids.userId, displayName: name, normalizedName: name.toLocaleLowerCase("pt-BR"), reconnectTokenHash });
        return { participant: participantDTO(created), created: true };
      }, "PARTICIPANT_ALREADY_JOINED");
    },
    async registerParticipant(input) {
      const { gameSessionId, displayName, reconnectToken } = parse(participantInputSchema, input, "PARTICIPANT_INVALID");
      const name = parse(displayNameSchema, displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
      if (name.length < 2) throw new DomainError("PARTICIPANT_INVALID");
      const reconnectTokenHash = await hashToken(reconnectToken);
      return transaction(client, async (tx) => {
        const repo = participantsOf(tx);
        const session = await rowOf(tx, gameSessionId);
        if (session.status !== "WAITING") throw new DomainError("SESSION_NOT_WAITING");
        if (await repo.count(gameSessionId) >= maxPlayers) throw new DomainError("ROOM_FULL");
        return participantDTO(await repo.add({ gameSessionId, displayName: name, normalizedName: name.toLocaleLowerCase("pt-BR"), reconnectTokenHash }));
      }, "PARTICIPANT_NAME_CONFLICT");
    },
    async resumeParticipant({ gameSessionId, participantId, reconnectToken }) {
      return transaction(client, async (tx) => {
        const repo = participantsOf(tx);
        await rowOf(tx, gameSessionId);
        const participant = await repo.get(participantId, gameSessionId);
        if (!participant || !(await verifyToken(reconnectToken, participant.reconnectTokenHash))) throw new DomainError("INVALID_RECONNECT_TOKEN");
        return participantDTO(await repo.updatePresence(participantId, gameSessionId, true));
      });
    },
    async resumeHost({ gameSessionId, hostToken, accountId }) {
      const row = await rowOf(client, gameSessionId);
      if (accountId && row.hostUserId === accountId) return sessionDTO(await states.view(client, row));
      if (hostToken && (await verifyToken(hostToken, row.hostTokenHash))) return sessionDTO(await states.view(client, row));
      throw new DomainError("INVALID_HOST_TOKEN");
    },
    async disconnectParticipant(gameSessionId, participantId) {
      return transaction(client, async (tx) => {
        await rowOf(tx, gameSessionId);
        return participantDTO(await participantsOf(tx).updatePresence(participantId, gameSessionId, false));
      });
    },
    async abandonIfEmpty(id) {
      return transaction(client, async (tx) => {
        const row = await rowOf(tx, id);
        if (row.status !== "ACTIVE") return null;
        if (await participantsOf(tx).activeCount(id)) return null;
        await finishState(tx, id);
        return sessionDTO(await requireView(tx, id));
      });
    },
    async leaveParticipant(gameSessionId, participantId) {
      return transaction(client, async (tx) => {
        await rowOf(tx, gameSessionId);
        return participantDTO(await participantsOf(tx).markLeft(participantId, gameSessionId));
      });
    },
    async registerAnswer(input) {
      const decision = parse(decisionSchema, input, "ANSWER_INVALID");
      return transaction(client, async (tx) => {
        const session = await requireView(tx, decision.gameSessionId);
        if (session.status !== "ACTIVE") throw new DomainError("SESSION_NOT_ACTIVE");
        if (!(await participantsOf(tx).get(decision.participantId, decision.gameSessionId))) throw new DomainError("PARTICIPANT_NOT_FOUND");
        const question = session.quizSnapshot.questions.find((candidate) => candidate.id === decision.questionRef);
        const option = question?.options.find((candidate) => candidate.id === decision.selectedOptionRef);
        if (!option) throw new DomainError("SNAPSHOT_REFERENCE_INVALID");
        if (option.isCorrect !== decision.isCorrect) throw new DomainError("ANSWER_DECISION_INVALID");
        return participantsOf(tx).answer(decision);
      }, "ANSWER_ALREADY_SUBMITTED");
    },
    finish(id) {
      return transaction(client, async (tx) => {
        const row = await rowOf(tx, id);
        if (row.status === "FINISHED") return sessionDTO(await states.view(tx, row));
        if (row.status !== "ACTIVE") throw new DomainError("SESSION_NOT_ACTIVE");
        await platform.matches.finish(tx, id);
        return sessionDTO(await requireView(tx, id));
      });
    },
  };
}
