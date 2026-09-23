import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { roomDTO } from "../platform/rooms.js";

// Compatibility facade over the platform services (room lookups, match start)
// plus the Quiz-only theme selection, which stays here until the room's
// game-specific setup moves out of the room row (ADR-008).
export function createRoomService(client, platform) {
  return {
    list: ({ gameKey } = {}) => platform.rooms.list({ gameKey }),
    get: (number) => platform.rooms.get(number),
    getById: (id) => platform.rooms.getById(id),
    async selectTheme(number, quizId) {
      return transaction(client, async (tx) => {
        const room = await tx.room.findUnique({ where: { number } });
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        if (room.status !== "OPEN") throw new DomainError("ROOM_NOT_WAITING");
        platform.policy.requireAvailable(room.gameKey);
        const quiz = await tx.quiz.findUnique({ where: { id: parse(z.uuid(), quizId, "QUIZ_NOT_FOUND") } });
        if (!quiz) throw new DomainError("QUIZ_NOT_FOUND");
        if (quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        return roomDTO(await tx.room.update({ where: { id: room.id }, data: { quizId: quiz.id }, include: { quiz: { select: { id: true, title: true } } } }));
      });
    },
    startMatch: (number, participants) => platform.matches.start(number, participants),
    // Frees the room, but only if `matchId` is still its current match.
    async reopen(roomId, matchId) {
      await platform.rooms.release(roomId, matchId);
      return platform.rooms.getById(roomId);
    },
  };
}
