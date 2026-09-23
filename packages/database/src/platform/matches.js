import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { sessionRepository } from "../repositories/sessions.js";
import { sessionDTO } from "../mappers/snapshot.js";
import { roomDTO } from "./rooms.js";

const displayNameSchema = z
  .string()
  .normalize("NFKC")
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !Array.from(value).some((character) => { const code = character.codePointAt(0); return code <= 31 || (code >= 127 && code <= 159); }), "INVALID_NAME");
const participantsSchema = z.array(z.object({ userId: z.uuid(), displayName: z.unknown() })).min(1).max(100);

// Match = one execution of a room's game. The platform decides *whether* a
// match can start (room open, game available, adapter registered, nobody else
// starting one) and records who plays; the game's adapter supplies everything
// game-specific. No branch here ever looks at which game it is.
export function createPlatformMatches({ client, policy, adapters, rooms, participants }) {
  function requireAdapter(gameKey) {
    const adapter = adapters.get(gameKey);
    if (!adapter) throw new DomainError("GAME_ADAPTER_MISSING");
    return adapter;
  }
  return {
    async start(roomNumber, presentParticipants) {
      const parsedParticipants = parse(participantsSchema, presentParticipants, "NO_PARTICIPANTS");
      return transaction(client, async (tx) => {
        const room = await tx.room.findUnique({ where: { number: roomNumber } });
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        policy.requireAvailable(room.gameKey);
        const adapter = requireAdapter(room.gameKey);
        if (room.status !== "OPEN" || room.currentSessionId) throw new DomainError("ROOM_NOT_WAITING");
        const { columns } = await adapter.prepareMatch({ tx, room });
        // Presence lives in Redis with a safety-net TTL, so an entry can outlive
        // its account. Materialize participants only for accounts that still
        // exist rather than failing the whole start on one stale entry.
        const knownAccounts = new Set((await tx.organizer.findMany({ where: { id: { in: parsedParticipants.map((p) => p.userId) } }, select: { id: true } })).map((row) => row.id));
        const roomCode = randomBytes(6).toString("hex").toUpperCase();
        const match = await tx.gameSession.create({ data: { roomCode, roomId: room.id, gameKey: room.gameKey, ...columns } });
        const seen = new Set();
        for (const entry of parsedParticipants) {
          if (seen.has(entry.userId) || !knownAccounts.has(entry.userId)) continue;
          seen.add(entry.userId);
          const displayName = parse(displayNameSchema, entry.displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
          const matchParticipant = await participants.add(tx, { matchId: match.id, userId: entry.userId });
          await adapter.createParticipantState({ tx, match, matchParticipant, displayName });
        }
        if (seen.size === 0) throw new DomainError("NO_PARTICIPANTS");
        await rooms.occupy(tx, room.id, match.id);
        return sessionDTO(await sessionRepository(tx).get(match.id));
      }, "ROOM_NOT_WAITING");
    },
    // Live matches that survive a restart, each with what the game says still
    // needs doing. PostgreSQL is the only input; Redis is not consulted.
    async recoverable() {
      const live = await sessionRepository(client).liveMatches();
      const recovered = [];
      for (const match of live) {
        const adapter = adapters.get(match.gameKey);
        if (!adapter) continue;
        const room = await client.room.findUnique({ where: { id: match.roomId }, include: { quiz: { select: { id: true, title: true } } } });
        if (!room) continue;
        const recovery = adapter.recoverMatch({ match });
        if (recovery) recovered.push({ match: sessionDTO(match), room: roomDTO(room), recovery });
      }
      return recovered;
    },
  };
}
