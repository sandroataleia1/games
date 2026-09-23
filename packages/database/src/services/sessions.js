import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { sessionRepository } from "../repositories/sessions.js";
import { quizRepository } from "../repositories/quizzes.js";
import { requireQuiz } from "./quizzes.js";
import { hashToken, verifyToken } from "./tokens.js";
import { calculatePoints, isResponseWithinDeadline } from "./scoring.js";
import {
  validateSnapshot,
  sessionDTO,
  participantDTO,
} from "../mappers/snapshot.js";

const idSchema = z.uuid();
const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,12}$/);
const displayNameSchema = z.string().normalize("NFKC").trim().min(2).max(24).refine((value) => !Array.from(value).some((character) => { const code = character.codePointAt(0); return code <= 31 || (code >= 127 && code <= 159); }), "INVALID_NAME");
const createSessionSchema = z
  .object({
    roomCode: z.unknown(),
    snapshot: z.unknown(),
    hostToken: z.unknown(),
  })
  .strict();
const participantInputSchema = z
  .object({
    gameSessionId: idSchema,
    displayName: z.unknown(),
    reconnectToken: z.unknown(),
  })
  .strict();
const decisionSchema = z
  .object({
    gameSessionId: idSchema,
    participantId: idSchema,
    questionRef: idSchema,
    selectedOptionRef: idSchema,
    isCorrect: z.boolean(),
    responseTimeMs: z.number().int().min(0).max(2147483647),
    pointsAwarded: z.number().int().min(0).max(2147483647),
  })
  .strict();
const matchAnswerSchema = z.object({ gameSessionId: idSchema, participantId: idSchema, questionRef: idSchema, selectedOptionRef: idSchema }).strict();
async function requireSession(repo, id) {
  const session = await repo.get(parse(idSchema, id, "SESSION_INVALID"));
  if (!session) throw new DomainError("SESSION_NOT_FOUND");
  return session;
}
export function createSessionService(client, { maxPlayers = 20 } = {}) {
  return {
    async startMatch(id) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, id);
        if (session.matchPhase !== "LOBBY") throw new DomainError("INVALID_STATE");
        if (!(await repo.activeParticipants(id))) throw new DomainError("NO_PARTICIPANTS");
        const snapshot = validateSnapshot(session.quizSnapshot);
        if (!snapshot.questions.length) throw new DomainError("NO_QUESTIONS");
        const now = new Date();
        const endsAt = new Date(now.getTime() + snapshot.questions[0].durationSeconds * 1000);
        return sessionDTO(await repo.startMatch(id, { currentQuestionIndex: 0, questionStartedAt: now, questionEndsAt: endsAt }));
      });
    },
    async answer(input) {
      const parsed = parse(matchAnswerSchema, input, "INVALID_ANSWER");
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, parsed.gameSessionId);
        if (session.matchPhase !== "QUESTION" || session.status !== "ACTIVE") throw new DomainError("INVALID_STATE");
        const now = new Date();
        if (!session.questionEndsAt || !isResponseWithinDeadline(now, session.questionEndsAt)) throw new DomainError("QUESTION_EXPIRED");
        const participant = await repo.participant(parsed.participantId, parsed.gameSessionId);
        if (!participant || participant.disconnectedAt) throw new DomainError("PARTICIPANT_NOT_ACTIVE");
        const snapshot = validateSnapshot(session.quizSnapshot);
        const question = snapshot.questions[session.currentQuestionIndex];
        if (!question || question.id !== parsed.questionRef) throw new DomainError("INVALID_ANSWER");
        const option = question.options.find((candidate) => candidate.id === parsed.selectedOptionRef);
        if (!option) throw new DomainError("INVALID_ANSWER");
        const existing = await repo.answersForQuestion(parsed.gameSessionId, parsed.questionRef);
        if (existing.some((answer) => answer.participantId === parsed.participantId)) throw new DomainError("ANSWER_ALREADY_SUBMITTED");
        const responseTimeMs = Math.max(0, now.getTime() - session.questionStartedAt.getTime());
        const pointsAwarded = calculatePoints({ basePoints: question.basePoints, responseTimeMs, durationMs: question.durationSeconds * 1000, isCorrect: option.isCorrect });
        await repo.answer({ gameSessionId: parsed.gameSessionId, participantId: parsed.participantId, questionRef: parsed.questionRef, selectedOptionRef: parsed.selectedOptionRef, isCorrect: option.isCorrect, responseTimeMs, pointsAwarded });
        await tx.participant.update({ where: { id_gameSessionId: { id: parsed.participantId, gameSessionId: parsed.gameSessionId } }, data: { score: { increment: pointsAwarded }, lastSeenAt: now } });
        return { answeredAt: now, isCorrect: option.isCorrect, pointsAwarded, responseTimeMs };
      }, "ANSWER_ALREADY_SUBMITTED");
    },
    async questionResult(id) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, id);
        if (session.matchPhase !== "QUESTION") throw new DomainError("INVALID_STATE");
        const snapshot = validateSnapshot(session.quizSnapshot);
        const question = snapshot.questions[session.currentQuestionIndex];
        const answers = await repo.answersForQuestion(id, question.id);
        const updated = await repo.setQuestionResult(id);
        return { session: sessionDTO(updated), question: { id: question.id, correctOptionId: question.options.find((option) => option.isCorrect).id, round: session.currentQuestionIndex + 1 }, answers, ranking: await repo.ranking(id) };
      });
    },
    async nextQuestion(id) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, id);
        if (session.matchPhase !== "QUESTION_RESULT") throw new DomainError("INVALID_STATE");
        const snapshot = validateSnapshot(session.quizSnapshot);
        const nextIndex = session.currentQuestionIndex + 1;
        if (nextIndex >= snapshot.questions.length) return { finished: true, session: sessionDTO(await repo.finishMatch(id)), ranking: await repo.ranking(id) };
        const now = new Date();
        const endsAt = new Date(now.getTime() + snapshot.questions[nextIndex].durationSeconds * 1000);
        return { finished: false, session: sessionDTO(await repo.setNextQuestion(id, { currentQuestionIndex: nextIndex, questionStartedAt: now, questionEndsAt: endsAt })) };
      });
    },
    async currentQuestion(id) {
      const session = await requireSession(sessionRepository(client), id);
      const snapshot = validateSnapshot(session.quizSnapshot);
      const question = session.currentQuestionIndex == null ? null : snapshot.questions[session.currentQuestionIndex];
      return { session, question, answers: question ? await sessionRepository(client).answersForQuestion(id, question.id) : [] };
    },
    async activeMatches() {
      return (await sessionRepository(client).activeMatches()).map(sessionDTO);
    },
    async create(input) {
      const { roomCode, snapshot, hostToken } = parse(
        createSessionSchema,
        input,
        "SESSION_INVALID",
      );
      const validated = validateSnapshot(snapshot);
      const code = parse(roomCodeSchema, roomCode, "ROOM_CODE_INVALID");
      const hostTokenHash = await hashToken(hostToken);
      return transaction(
        client,
        async (tx) => {
          const quiz = await requireQuiz(quizRepository(tx), validated.quizId);
          if (quiz.status !== "PUBLISHED")
            throw new DomainError("QUIZ_NOT_PUBLISHED");
          return sessionDTO(
            await sessionRepository(tx).create({
              roomCode: code,
              quizId: validated.quizId,
              quizSnapshot: validated,
              hostTokenHash,
            }),
          );
        },
        "ROOM_CODE_CONFLICT",
      );
    },
    async getById(id) {
      return sessionDTO(await requireSession(sessionRepository(client), id));
    },
    async getByCode(code) {
      return sessionDTO(
        await sessionRepository(client).byCode(
          parse(roomCodeSchema, code, "ROOM_CODE_INVALID"),
        ),
      );
    },
    async publicRoomsForQuiz(quizId) {
      const rows = await sessionRepository(client).publicRoomsForQuiz(parse(idSchema, quizId, "QUIZ_INVALID"));
      return rows.map((row) => ({
        roomCode: row.roomCode,
        quizId: row.quizId,
        hostName: row.host?.name ?? null,
        playerCount: row._count.participants,
        maxPlayers,
        status: row.status,
        createdAt: row.createdAt,
        canJoin: row._count.participants < maxPlayers,
      }));
    },
    async resumePresenceForAccount(gameSessionId, userId) {
      const ids = { gameSessionId: parse(idSchema, gameSessionId, "SESSION_INVALID"), userId: parse(idSchema, userId, "PARTICIPANT_INVALID") };
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const row = await repo.participantByUser(ids.gameSessionId, ids.userId);
        if (!row) return null;
        return participantDTO(await repo.updatePresence(row.id, ids.gameSessionId, true));
      });
    },
    async enterAsAccount({ gameSessionId, userId, displayName }) {
      const ids = parse(z.object({ gameSessionId: idSchema, userId: idSchema }).strict(), { gameSessionId, userId }, "PARTICIPANT_INVALID");
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, ids.gameSessionId);
        const existing = await repo.participantByUser(ids.gameSessionId, ids.userId);
        if (existing) return { participant: participantDTO(await repo.updatePresence(existing.id, ids.gameSessionId, true)), created: false };
        if (session.status !== "WAITING") throw new DomainError("SESSION_NOT_WAITING");
        if (await repo.countParticipants(ids.gameSessionId) >= maxPlayers) throw new DomainError("ROOM_FULL");
        const name = parse(displayNameSchema, displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
        const reconnectTokenHash = await hashToken(randomBytes(32).toString("hex"));
        const created = await repo.addParticipant({ gameSessionId: ids.gameSessionId, userId: ids.userId, displayName: name, normalizedName: name.toLocaleLowerCase("pt-BR"), reconnectTokenHash });
        return { participant: participantDTO(created), created: true };
      }, "PARTICIPANT_ALREADY_JOINED");
    },
    async registerParticipant(input) {
      const { gameSessionId, displayName, reconnectToken } = parse(
        participantInputSchema,
        input,
        "PARTICIPANT_INVALID",
      );
      const name = parse(
        displayNameSchema,
        displayName,
        "PARTICIPANT_INVALID",
      ).replace(/\s+/gu, " ");
      if (name.length < 2) throw new DomainError("PARTICIPANT_INVALID");
      const reconnectTokenHash = await hashToken(reconnectToken);
      return transaction(
        client,
        async (tx) => {
          const repo = sessionRepository(tx);
          const session = await requireSession(repo, gameSessionId);
          if (session.status !== "WAITING")
            throw new DomainError("SESSION_NOT_WAITING");
          if (await repo.countParticipants(gameSessionId) >= maxPlayers)
            throw new DomainError("ROOM_FULL");
          return participantDTO(
            await repo.addParticipant({
              gameSessionId,
              displayName: name,
              normalizedName: name.toLocaleLowerCase("pt-BR"),
              reconnectTokenHash,
            }),
          );
        },
        "PARTICIPANT_NAME_CONFLICT",
      );
    },
    async resumeParticipant({ gameSessionId, participantId, reconnectToken }) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        await requireSession(repo, gameSessionId);
        const participant = await repo.participant(participantId, gameSessionId);
        if (!participant || !(await verifyToken(reconnectToken, participant.reconnectTokenHash)))
          throw new DomainError("INVALID_RECONNECT_TOKEN");
        return participantDTO(await repo.updatePresence(participantId, gameSessionId, true));
      });
    },
    async resumeHost({ gameSessionId, hostToken, accountId }) {
      const session = await requireSession(sessionRepository(client), gameSessionId);
      if (accountId && session.hostUserId === accountId) return sessionDTO(session);
      if (hostToken && (await verifyToken(hostToken, session.hostTokenHash)))
        return sessionDTO(session);
      throw new DomainError("INVALID_HOST_TOKEN");
    },
    async disconnectParticipant(gameSessionId, participantId) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        await requireSession(repo, gameSessionId);
        return participantDTO(await repo.updatePresence(participantId, gameSessionId, false));
      });
    },
    async abandonIfEmpty(id) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, id);
        if (session.status !== "ACTIVE") return null;
        if (await repo.activeParticipants(id)) return null;
        return sessionDTO(await repo.finishMatch(id));
      });
    },
    async leaveParticipant(gameSessionId, participantId) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        await requireSession(repo, gameSessionId);
        return participantDTO(await repo.markLeft(participantId, gameSessionId));
      });
    },
    async registerAnswer(input) {
      const decision = parse(decisionSchema, input, "ANSWER_INVALID");
      return transaction(
        client,
        async (tx) => {
          const repo = sessionRepository(tx);
          const session = await requireSession(repo, decision.gameSessionId);
          if (session.status !== "ACTIVE")
            throw new DomainError("SESSION_NOT_ACTIVE");
          if (
            !(await repo.participant(
              decision.participantId,
              decision.gameSessionId,
            ))
          )
            throw new DomainError("PARTICIPANT_NOT_FOUND");
          const snapshot = validateSnapshot(session.quizSnapshot);
          const question = snapshot.questions.find(
            (question) => question.id === decision.questionRef,
          );
          const option = question?.options.find(
            (option) => option.id === decision.selectedOptionRef,
          );
          if (!option) throw new DomainError("SNAPSHOT_REFERENCE_INVALID");
          if (option.isCorrect !== decision.isCorrect)
            throw new DomainError("ANSWER_DECISION_INVALID");
          return repo.addAnswer(decision);
        },
        "ANSWER_ALREADY_SUBMITTED",
      );
    },
    finish(id) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        const session = await requireSession(repo, id);
        if (session.status === "FINISHED") return sessionDTO(session);
        if (session.status !== "ACTIVE")
          throw new DomainError("SESSION_NOT_ACTIVE");
        return sessionDTO(await repo.finish(id));
      });
    },
  };
}
