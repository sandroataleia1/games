import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { sessionRepository } from "../repositories/sessions.js";
import { quizRepository } from "../repositories/quizzes.js";
import { requireQuiz } from "./quizzes.js";
import { hashToken, verifyToken } from "./tokens.js";
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
async function requireSession(repo, id) {
  const session = await repo.get(parse(idSchema, id, "SESSION_INVALID"));
  if (!session) throw new DomainError("SESSION_NOT_FOUND");
  return session;
}
export function createSessionService(client, { maxPlayers = 20 } = {}) {
  return {
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
    async resumeHost({ gameSessionId, hostToken }) {
      const session = await requireSession(sessionRepository(client), gameSessionId);
      if (!(await verifyToken(hostToken, session.hostTokenHash)))
        throw new DomainError("INVALID_HOST_TOKEN");
      return sessionDTO(session);
    },
    async disconnectParticipant(gameSessionId, participantId) {
      return transaction(client, async (tx) => {
        const repo = sessionRepository(tx);
        await requireSession(repo, gameSessionId);
        return participantDTO(await repo.updatePresence(participantId, gameSessionId, false));
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
