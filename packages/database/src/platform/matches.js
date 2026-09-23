import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parse, DomainError } from "../errors/domain-error.js";
import { transaction } from "../repositories/transaction.js";
import { roomDTO } from "./rooms.js";

const displayNameSchema = z
  .string()
  .normalize("NFKC")
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !Array.from(value).some((character) => { const code = character.codePointAt(0); return code <= 31 || (code >= 127 && code <= 159); }), "INVALID_NAME");
const participantsSchema = z.array(z.object({ userId: z.uuid(), displayName: z.unknown() })).min(1).max(100);
const include = { matchParticipants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] } };

// Generic match DTO: platform fields only. Whatever a game keeps about its
// match (snapshot, phase, scores...) is served by the game itself.
export function matchDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomCode: row.roomCode,
    roomId: row.roomId,
    gameKey: row.gameKey,
    status: row.status,
    hostUserId: row.hostUserId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cancelledAt: row.cancelledAt,
    participants: (row.matchParticipants ?? []).map(({ id, userId, joinedAt, leftAt }) => ({ id, userId, joinedAt, leftAt })),
  };
}

// Match = one execution of a room's game. The platform decides *whether* a
// match can start (room open, game available, runtime registered, nobody else
// starting one) and records who plays; the game's runtime supplies everything
// game-specific through its persistence hooks. No branch here ever looks at
// which game it is.
export function createPlatformMatches({ client, policy, runtimes, rooms, participants }) {
  function requireRuntime(gameKey) {
    const runtime = runtimes.get(gameKey);
    if (!runtime) throw new DomainError("GAME_ADAPTER_MISSING");
    return runtime;
  }
  return {
    async start(roomNumber, presentParticipants) {
      const parsedParticipants = parse(participantsSchema, presentParticipants, "NO_PARTICIPANTS");
      return transaction(client, async (tx) => {
        const room = await tx.room.findUnique({ where: { number: roomNumber } });
        if (!room) throw new DomainError("ROOM_NOT_FOUND");
        policy.requireAvailable(room.gameKey);
        const { persistence } = requireRuntime(room.gameKey);
        if (room.status !== "OPEN" || room.currentSessionId) throw new DomainError("ROOM_NOT_WAITING");
        // `compatColumns` is opaque to the platform: columns a game still
        // mirrors on the match row while an older release may be running.
        const { prepared, compatColumns = {} } = await persistence.prepareMatch({ tx, room });
        // Presence lives in Redis with a safety-net TTL, so an entry can outlive
        // its account. Materialize participants only for accounts that still
        // exist rather than failing the whole start on one stale entry.
        const knownAccounts = new Set((await tx.organizer.findMany({ where: { id: { in: parsedParticipants.map((p) => p.userId) } }, select: { id: true } })).map((row) => row.id));
        const roomCode = randomBytes(6).toString("hex").toUpperCase();
        const match = await tx.gameSession.create({ data: { roomCode, roomId: room.id, gameKey: room.gameKey, ...compatColumns } });
        await persistence.createMatchState({ tx, match, prepared });
        const seen = new Set();
        for (const entry of parsedParticipants) {
          if (seen.has(entry.userId) || !knownAccounts.has(entry.userId)) continue;
          seen.add(entry.userId);
          const displayName = parse(displayNameSchema, entry.displayName, "PARTICIPANT_INVALID").replace(/\s+/gu, " ");
          const matchParticipant = await participants.add(tx, { matchId: match.id, userId: entry.userId });
          await persistence.createParticipantState({ tx, match, matchParticipant, displayName });
        }
        if (seen.size === 0) throw new DomainError("NO_PARTICIPANTS");
        await rooms.occupy(tx, room.id, match.id);
        return matchDTO(await tx.gameSession.findUnique({ where: { id: match.id }, include }));
      }, "ROOM_NOT_WAITING");
    },
    async get(id, db = client) {
      const row = await db.gameSession.findUnique({ where: { id: parse(z.uuid(), id, "SESSION_NOT_FOUND") }, include });
      if (!row) throw new DomainError("SESSION_NOT_FOUND");
      return matchDTO(row);
    },
    // WAITING -> ACTIVE. Idempotent: an already started match is left alone.
    async activate(db, id) {
      await db.gameSession.updateMany({ where: { id, status: "WAITING" }, data: { status: "ACTIVE", startedAt: new Date() } });
    },
    // -> FINISHED. Idempotent: the first finish time is kept.
    async finish(db, id) {
      await db.gameSession.updateMany({ where: { id, status: { not: "FINISHED" } }, data: { status: "FINISHED", finishedAt: new Date() } });
    },
    // Live matches that survive a restart. PostgreSQL is the only input; the
    // limit is a safety net (there is at most one live match per room, and the
    // room pool is fixed). What each game must rebuild is the game's business.
    async live({ limit = 200 } = {}) {
      const rows = await client.gameSession.findMany({ where: { status: "ACTIVE", roomId: { not: null } }, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit });
      const found = [];
      for (const row of rows) {
        const room = await client.room.findUnique({ where: { id: row.roomId } });
        if (room) found.push({ match: matchDTO(row), room: roomDTO(room) });
      }
      return found;
    },
  };
}
