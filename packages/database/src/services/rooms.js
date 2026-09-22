import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { roomRepository } from "../repositories/rooms.js";
import { snapshotFromQuiz, sessionDTO } from "../mappers/snapshot.js";
import { hashToken } from "./tokens.js";

const displayNameSchema = z
  .string()
  .normalize("NFKC")
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !Array.from(value).some((character) => { const code = character.codePointAt(0); return code <= 31 || (code >= 127 && code <= 159); }), "INVALID_NAME");
const participantsSchema = z.array(z.object({ userId: z.uuid(), displayName: z.unknown() })).min(1).max(100);

function roomDTO(room) {
  return { number: room.number, status: room.status, quizId: room.quizId, quizTitle: room.quiz?.title ?? null, currentSessionId: room.currentSessionId ?? null };
}

export function createRoomService(client) {
  return {
    async list() {
      return (await roomRepository(client).list()).map(roomDTO);
    },
    async get(number) {
      const room = await roomRepository(client).byNumber(parse(z.number().int().positive(), number, "ROOM_NOT_FOUND"));
      if (!room) throw new DomainError("ROOM_NOT_FOUND");
      return roomDTO(room);
    },
    async getById(id) {
      const room = await roomRepository(client).byId(parse(z.uuid(), id, "ROOM_NOT_FOUND"));
      if (!room) throw new DomainError("ROOM_NOT_FOUND");
      return roomDTO(room);
    },
    async selectTheme(number, quizId) {
      return transaction(client, async (tx) => {
        const room = await tx.room.findUnique({ where: { number } });
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        if (room.status !== "OPEN") throw new DomainError("ROOM_NOT_WAITING");
        const quiz = await tx.quiz.findUnique({ where: { id: parse(z.uuid(), quizId, "QUIZ_NOT_FOUND") } });
        if (!quiz) throw new DomainError("QUIZ_NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        return roomDTO(await tx.room.update({ where: { id: room.id }, data: { quizId: quiz.id }, include: { quiz: { select: { id: true, title: true } } } }));
      });
    },
    async startMatch(number, participants) {
      const parsedParticipants = parse(participantsSchema, participants, "NO_PARTICIPANTS");
      return transaction(client, async (tx) => {
        const room = await roomRepository(tx).byNumberWithQuestions(number);
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        if (room.status !== "OPEN") throw new DomainError("ROOM_NOT_WAITING");
        if (!room.quiz) throw new DomainError("QUIZ_NOT_PUBLISHED");
        if (room.quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        const snapshot = snapshotFromQuiz(room.quiz);
        if (!snapshot.questions.length) throw new DomainError("NO_QUESTIONS");
        // Presence is tracked in Redis with a safety-net TTL, so an entry can
        // in rare cases outlive the account it points to (e.g. a missed
        // disconnect event). Only materialize participants for accounts that
        // still exist rather than letting one stale entry fail the whole start.
        const knownAccounts = new Set((await tx.organizer.findMany({ where: { id: { in: parsedParticipants.map((p) => p.userId) } }, select: { id: true } })).map((row) => row.id));
        const roomCode = randomBytes(6).toString("hex").toUpperCase();
        const session = await tx.gameSession.create({ data: { roomCode, roomId: room.id, quizId: room.quiz.id, quizSnapshot: snapshot } });
        const seen = new Set();
        for (const participant of parsedParticipants) {
          if (seen.has(participant.userId) || !knownAccounts.has(participant.userId)) continue;
          seen.add(participant.userId);
          const name = parse(displayNameSchema, participant.displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
          await tx.participant.create({ data: { gameSessionId: session.id, userId: participant.userId, displayName: name, normalizedName: name.toLocaleLowerCase("pt-BR"), reconnectTokenHash: await hashToken(randomBytes(32).toString("hex")) } });
        }
        if (seen.size === 0) throw new DomainError("NO_PARTICIPANTS");
        await roomRepository(tx).startMatch(room.id, session.id);
        return sessionDTO(await tx.gameSession.findUnique({ where: { id: session.id }, include: { participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } } }));
      }, "PARTICIPANT_ALREADY_JOINED");
    },
    async reopen(roomId) {
      return roomDTO(await roomRepository(client).reopen(roomId));
    },
  };
}
