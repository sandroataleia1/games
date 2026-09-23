import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as connectClient } from "socket.io-client";
import { createClient as createRedisClient } from "redis";
import { createServerDatabase as createDatabase } from "@multygames/server-bootstrap";
import { EVENTS } from "@quizarena/contracts";
import { createClient as createDatabaseClient } from "../../../packages/database/src/client.js";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const database = createDatabase({ databaseUrl });
const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: "quizarena:test:rate:platform" });
const clients = [];
const ROOM = 22; // a Quiz room from the pool
const OTHER_GAME_ROOM = 991; // a room that belongs to a game the Quiz runtime does not serve
const startedAt = new Date();
let accountId;

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}
async function connect(token) {
  const client = connectClient(`http://127.0.0.1:${server.httpServer.address().port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  return client;
}

test("the existing v1 protocol is unchanged: same event names, gameKey added to room and match DTOs", async () => {
  // Frozen list of the events a client written before PLATFORM-07B relies on.
  expect(EVENTS).toMatchObject({
    ROOM_LIST: "v1:room:list", ROOM_ENTER: "v1:room:enter", ROOM_LEAVE: "v1:room:leave", ROOM_STATE: "v1:room:state", ROOM_INDEX: "v1:room:index",
    THEME_SELECT: "v1:room:theme-select", MATCH_START: "v1:match:start", GAME_ANSWER: "v1:game:answer", GAME_NEXT: "v1:game:next",
    GAME_STATE: "v1:game:state", GAME_QUESTION: "v1:game:question", GAME_QUESTION_RESULT: "v1:game:question-result", GAME_RANKING: "v1:game:ranking", GAME_FINISHED: "v1:game:finished",
  });
  await lobby.connect();
  server.setLobby(lobby);
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const auth = await database.organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const ana = await database.organizers.register({ name: "Ana", email: `ana-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  accountId = ana.user.id;
  const quiz = (await database.organizers.publishedOwned(auth.user.id))[0];
  const player = await connect(ana.token);

  const listed = await command(player, EVENTS.ROOM_LIST, {});
  expect(listed.ok).toBe(true);
  expect(listed.data.rooms.length).toBeGreaterThan(0);
  expect(listed.data.rooms.every((room) => room.gameKey === "quiz")).toBe(true);
  expect(listed.data.rooms.some((room) => "currentSessionId" in room)).toBe(false);

  const entered = await command(player, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(entered.ok).toBe(true);
  expect(entered.data.room).toMatchObject({ roomNumber: ROOM, gameKey: "quiz", status: "OPEN" });
  expect((await command(player, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id })).ok).toBe(true);

  const started = await command(player, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  expect(started.data.match).toMatchObject({ gameKey: "quiz", roomNumber: ROOM, phase: "QUESTION" });

  // The generalisation must not widen what a client sees.
  const serialized = JSON.stringify([entered.data, started.data]);
  for (const forbidden of ["isCorrect", "quizSnapshot", "hostTokenHash", "reconnectTokenHash", "passwordHash", "matchParticipant", "roomCode", "currentSessionId"]) expect(serialized).not.toContain(forbidden);
  expect((await command(player, EVENTS.ROOM_LEAVE, { roomNumber: ROOM })).ok).toBe(true);
  expect((await database.rooms.get(ROOM)).status).toBe("OPEN");
});

test("a room that belongs to another game is invisible to the Quiz runtime", async () => {
  const cleanup = createDatabaseClient(databaseUrl);
  try {
    await cleanup.room.upsert({ where: { number: OTHER_GAME_ROOM }, update: {}, create: { number: OTHER_GAME_ROOM, gameKey: "other-game" } });
    const ana = await database.organizers.register({ name: "Bia", email: `bia-${randomUUID()}@example.com`, password: "SenhaSegura123" });
    const player = await connect(ana.token);
    const listed = await command(player, EVENTS.ROOM_LIST, {});
    expect(listed.data.rooms.map((room) => room.number)).not.toContain(OTHER_GAME_ROOM);
    const entered = await command(player, EVENTS.ROOM_ENTER, { roomNumber: OTHER_GAME_ROOM });
    // Same answer as a room that does not exist: nothing about the other game leaks.
    const missing = await command(player, EVENTS.ROOM_ENTER, { roomNumber: 993 });
    expect(entered.ok).toBe(false);
    expect(entered.error.code).toBe("ROOM_NOT_FOUND");
    expect(entered.error).toEqual(missing.error);
    expect(JSON.stringify(entered)).not.toContain("other-game");
    await cleanup.organizerSession.deleteMany({ where: { ownerId: ana.user.id } });
    await cleanup.organizer.delete({ where: { id: ana.user.id } });
  } finally {
    await cleanup.room.deleteMany({ where: { number: OTHER_GAME_ROOM } });
    await cleanup.$disconnect();
  }
});

test("with Redis unavailable, commands fail closed and PostgreSQL state is not touched", async () => {
  const isolatedServer = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
  // Never connected: the runtime is not ready, exactly as when Redis is down.
  isolatedServer.setLobby(createLobbyRuntime({ io: isolatedServer.io, database, redisUrl, rateLimitPrefix: "quizarena:test:rate:platform-down" }));
  await new Promise((resolve) => isolatedServer.httpServer.listen(0, resolve));
  const ana = await database.organizers.register({ name: "Caio", email: `caio-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  const client = connectClient(`http://127.0.0.1:${isolatedServer.httpServer.address().port}`, { transports: ["websocket"], extraHeaders: { Cookie: `quizarena_session=${ana.token}` } });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  const before = await database.rooms.get(ROOM);
  const entered = await command(client, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(entered).toMatchObject({ ok: false, error: { code: "DEPENDENCY_UNAVAILABLE" } });
  const started = await command(client, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(false);
  expect(await database.rooms.get(ROOM)).toEqual(before);
  await isolatedServer.close();
  const cleanup = createDatabaseClient(databaseUrl);
  await cleanup.organizerSession.deleteMany({ where: { ownerId: ana.user.id } });
  await cleanup.organizer.delete({ where: { id: ana.user.id } });
  await cleanup.$disconnect();
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await server.close();
  await database.close();
  const cleanup = createDatabaseClient(databaseUrl);
  const room = await cleanup.room.findUnique({ where: { number: ROOM } });
  if (room) {
    const sessions = await cleanup.gameSession.findMany({ where: { roomId: room.id, createdAt: { gte: startedAt } }, select: { id: true } }); // only what this run created
    const sessionIds = sessions.map((session) => session.id);
    await cleanup.room.update({ where: { id: room.id }, data: { status: "OPEN", quizId: null, currentSessionId: null } });
    await cleanup.quizRoomConfiguration.deleteMany({ where: { roomId: room.id } });
    await cleanup.answer.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await cleanup.quizParticipantState.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await cleanup.matchParticipant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await cleanup.quizMatchState.deleteMany({ where: { matchId: { in: sessionIds } } });
    await cleanup.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  if (accountId) {
    await cleanup.organizerSession.deleteMany({ where: { ownerId: accountId } });
    await cleanup.organizer.delete({ where: { id: accountId } });
  }
  await cleanup.$disconnect();
  const redis = createRedisClient({ url: redisUrl });
  await redis.connect();
  const keys = await redis.keys(`quizarena:room:presence:${ROOM}:*`);
  if (keys.length) await redis.del(keys);
  await redis.disconnect();
});
