import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";

const numberSchema = z.number().int().positive();

// Generic room DTO (internal to the server: `id` and `currentSessionId` are
// never sent to clients). Whatever a game configures on a room - the Quiz's
// theme - is the game's own projection, not part of this DTO.
export function roomDTO(room) {
  return { id: room.id, number: room.number, status: room.status, gameKey: room.gameKey, currentSessionId: room.currentSessionId ?? null };
}

// Room = the meeting place: a numbered, persistent slot bound to one game.
// OPEN/PLAYING is the room's occupancy, unrelated to a match's own status.
export function createPlatformRooms(client, policy) {
  return {
    async create({ number, gameKey }) {
      policy.requireAvailable(gameKey);
      const parsed = parse(numberSchema, number, "ROOM_NOT_FOUND");
      const created = await transaction(client, (tx) => tx.room.create({ data: { number: parsed, gameKey } }), "ROOM_NUMBER_CONFLICT");
      return roomDTO(created);
    },
    async list({ gameKey } = {}) {
      const rows = await client.room.findMany({ where: gameKey ? { gameKey } : undefined, orderBy: { number: "asc" } });
      return rows.map(roomDTO);
    },
    async get(number) {
      const room = await client.room.findUnique({ where: { number: parse(numberSchema, number, "ROOM_NOT_FOUND") } });
      if (!room) throw new DomainError("ROOM_NOT_FOUND");
      return roomDTO(room);
    },
    async getById(id) {
      const room = await client.room.findUnique({ where: { id: parse(z.uuid(), id, "ROOM_NOT_FOUND") } });
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
