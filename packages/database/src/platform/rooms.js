import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";

const numberSchema = z.number().int().positive();
const include = { quiz: { select: { id: true, title: true } } };

// quizId/quizTitle are the legacy Quiz theme still stored on the room row;
// they stay in the DTO so the existing protocol is unchanged (ADR-008).
export function roomDTO(room) {
  return { number: room.number, status: room.status, gameKey: room.gameKey, quizId: room.quizId, quizTitle: room.quiz?.title ?? null, currentSessionId: room.currentSessionId ?? null };
}

// Room = the meeting place: a numbered, persistent slot bound to one game.
// OPEN/PLAYING is the room's occupancy, unrelated to a match's own status.
export function createPlatformRooms(client, policy) {
  return {
    async create({ number, gameKey }) {
      policy.requireAvailable(gameKey);
      const parsed = parse(numberSchema, number, "ROOM_NOT_FOUND");
      const created = await transaction(client, (tx) => tx.room.create({ data: { number: parsed, gameKey }, include }), "ROOM_NUMBER_CONFLICT");
      return roomDTO(created);
    },
    async list({ gameKey } = {}) {
      const rows = await client.room.findMany({ where: gameKey ? { gameKey } : undefined, include, orderBy: { number: "asc" } });
      return rows.map(roomDTO);
    },
    async get(number) {
      const room = await client.room.findUnique({ where: { number: parse(numberSchema, number, "ROOM_NOT_FOUND") }, include });
      if (!room) throw new DomainError("ROOM_NOT_FOUND");
      return roomDTO(room);
    },
    async getById(id) {
      const room = await client.room.findUnique({ where: { id: parse(z.uuid(), id, "ROOM_NOT_FOUND") }, include });
      if (!room) throw new DomainError("ROOM_NOT_FOUND");
      return roomDTO(room);
    },
    // Compare-and-set: only an OPEN, unoccupied room can be taken, so two
    // instances racing for the same room cannot both succeed.
    async occupy(tx, roomId, matchId) {
      const { count } = await tx.room.updateMany({ where: { id: roomId, status: "OPEN", currentSessionId: null }, data: { status: "PLAYING", currentSessionId: matchId } });
      if (count !== 1) throw new DomainError("ROOM_NOT_WAITING");
    },
    // Idempotent and safe against stale callers: only the match that currently
    // occupies the room can release it, so a late "finish" of an old match
    // never frees a room that already hosts a newer one.
    async release(roomId, matchId) {
      const { count } = await client.room.updateMany({ where: { id: roomId, currentSessionId: matchId }, data: { status: "OPEN", currentSessionId: null } });
      return count === 1;
    },
  };
}
