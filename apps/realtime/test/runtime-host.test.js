import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as connectClient } from "socket.io-client";
import { createClient as createRedisClient } from "redis";
import { createGameRegistry } from "@multygames/game-registry";
import { quizGame } from "@multygames/game-quiz";
import { createServerDatabase } from "@multygames/server-bootstrap";
import { createSyntheticRuntime, syntheticGameModule } from "@multygames/server-bootstrap/testing";
import { defineGameRuntime } from "@multygames/game-runtime";
import { EVENTS } from "@quizarena/contracts";
import { createClient as createDatabaseClient } from "../../../packages/database/src/client.js";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

// A SECOND game (synthetic, test-only) coexisting with the Quiz in one realtime
// process. It has its own definition, runtime, persistence and protocol, and never
// touches Quiz tables. The application registers only the Quiz.
config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const FAKE_ROOM = 991;
const BAD_ROOM = 992;
const QUIZ_ROOM = 20;
const fake = createSyntheticRuntime("fake-game");
const bad = createSyntheticRuntime("bad-game");
// A runtime whose recovery always fails: it must not stop the others.
const failing = defineGameRuntime({ ...bad.runtime, realtime: { ...bad.runtime.realtime, recoverMatch: async () => { throw new Error("boom"); } } });
const catalog = createGameRegistry([quizGame, syntheticGameModule("fake-game"), syntheticGameModule("bad-game")]);
const errors = [];
const logger = { error: (message) => errors.push(String(message)), warn() {}, info() {} };
const database = createServerDatabase({ databaseUrl, catalog, extraRuntimes: [fake.runtime, failing], logger });
const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: `quizarena:test:rate:host:${randomUUID()}`, logger });
const clients = [];
const startedAt = new Date();
const accountIds = [];

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}
async function connect(token) {
  const client = connectClient(`http://127.0.0.1:${server.httpServer.address().port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  return client;
}

test("the host serves two games at once, each through its own runtime and protocol", async () => {
  const cleanup = createDatabaseClient(databaseUrl);
  await cleanup.room.upsert({ where: { number: FAKE_ROOM }, update: {}, create: { number: FAKE_ROOM, gameKey: "fake-game" } });
  await cleanup.room.upsert({ where: { number: BAD_ROOM }, update: {}, create: { number: BAD_ROOM, gameKey: "bad-game" } });
  await lobby.connect();
  server.setLobby(lobby);
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const ana = await database.organizers.register({ name: "Ana", email: `ana-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  accountIds.push(ana.user.id);
  const player = await connect(ana.token);

  // With two games the host cannot guess which one an old-style request means.
  expect((await command(player, EVENTS.ROOM_LIST, {})).error.code).toBe("INVALID_PAYLOAD");
  const fakeList = await command(player, EVENTS.ROOM_LIST, { gameKey: "fake-game" });
  expect(fakeList.data.rooms.map((room) => room.number)).toContain(FAKE_ROOM);
  expect(fakeList.data.rooms.every((room) => room.gameKey === "fake-game")).toBe(true);
  const quizList = await command(player, EVENTS.ROOM_LIST, { gameKey: "quiz" });
  expect(quizList.data.rooms.map((room) => room.number)).not.toContain(FAKE_ROOM);
  expect(quizList.data.rooms.every((room) => room.gameKey === "quiz")).toBe(true);
  expect((await command(player, EVENTS.ROOM_LIST, { gameKey: "ghost" })).ok).toBe(false);

  // The fake room is served by the fake runtime: its projection, its hooks.
  const entered = await command(player, EVENTS.ROOM_ENTER, { roomNumber: FAKE_ROOM });
  expect(entered.ok).toBe(true);
  expect(entered.data.room).toMatchObject({ roomNumber: FAKE_ROOM, gameKey: "fake-game", status: "OPEN" });
  expect(entered.data.room).not.toHaveProperty("quizId");
  expect(fake.state.joined).toContain(FAKE_ROOM);

  // Its own event answers; the Quiz's events do not reach into a fake room.
  expect((await command(player, "test:fake-game:ping", { n: 1 })).data).toEqual({ pong: true, game: "fake-game" });
  expect(fake.state.events).toEqual([{ n: 1 }]);
  expect((await command(player, EVENTS.THEME_SELECT, { roomNumber: FAKE_ROOM, quizId: randomUUID() })).error.code).toBe("ROOM_NOT_FOUND");
  expect((await command(player, EVENTS.GAME_ANSWER, { roomNumber: FAKE_ROOM, questionId: randomUUID(), optionId: randomUUID() })).error.code).toBe("UNAUTHORIZED");

  // The generic start runs the platform transaction and then the fake game's hook - no Quiz state anywhere.
  const started = await command(player, EVENTS.MATCH_START, { roomNumber: FAKE_ROOM });
  expect(started.ok).toBe(true);
  expect(started.data.match).toMatchObject({ gameKey: "fake-game", phase: "SYNTHETIC" });
  expect(fake.state.calls).toEqual(["prepareMatch", "createMatchState", "createParticipantState"]);
  const room = await database.rooms.get(FAKE_ROOM);
  expect(room.status).toBe("PLAYING");
  expect(await cleanup.quizMatchState.count({ where: { matchId: room.currentSessionId } })).toBe(0);
  expect(await cleanup.quizParticipantState.count({ where: { gameSessionId: room.currentSessionId } })).toBe(0);
  const row = await cleanup.gameSession.findUnique({ where: { id: room.currentSessionId } });
  expect([row.quizId, row.quizSnapshot]).toEqual([null, null]);

  // The Quiz keeps working next to it, on its own room.
  const quizEntered = await command(player, EVENTS.ROOM_ENTER, { roomNumber: QUIZ_ROOM });
  expect(quizEntered.data.room).toMatchObject({ roomNumber: QUIZ_ROOM, gameKey: "quiz", quizId: null });
  expect((await command(player, EVENTS.QUIZ_LIST, {})).ok).toBe(true);
  await cleanup.$disconnect();
});

test("recovery is isolated per match: a game whose recovery fails does not stop the others", async () => {
  const cleanup = createDatabaseClient(databaseUrl);
  const accountId = accountIds[0];
  // A live match for the fake game and one for the failing game, straight from the platform.
  const fakeRoom = await cleanup.room.findUnique({ where: { number: FAKE_ROOM } });
  const badRoom = await cleanup.room.findUnique({ where: { number: BAD_ROOM } });
  await database.rooms.startMatch(BAD_ROOM, [{ userId: accountId, displayName: "Ana" }]);
  await cleanup.gameSession.updateMany({ where: { roomId: { in: [fakeRoom.id, badRoom.id] }, status: { in: ["WAITING", "ACTIVE"] } }, data: { status: "ACTIVE" } });
  fake.state.recovered.length = 0;
  errors.length = 0;
  await lobby.recoverActiveMatches();
  const fakeMatch = await cleanup.gameSession.findFirst({ where: { roomId: fakeRoom.id }, orderBy: { createdAt: "desc" } });
  expect(fake.state.recovered).toContain(fakeMatch.id);
  expect(errors.some((message) => message.includes("recovery of match") && message.includes("failed"))).toBe(true);
  await cleanup.$disconnect();
});

test("a match of a game with no runtime is reported, not guessed at, and recovery goes on", async () => {
  const withoutRuntime = createServerDatabase({ databaseUrl, catalog: createGameRegistry([quizGame, syntheticGameModule("fake-game", "DISABLED")]), extraRuntimes: [], logger });
  const isolated = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database: withoutRuntime });
  const isolatedLobby = createLobbyRuntime({ io: isolated.io, database: withoutRuntime, redisUrl, rateLimitPrefix: `quizarena:test:rate:host-none:${randomUUID()}`, logger });
  errors.length = 0;
  try {
    await isolatedLobby.connect();
    expect(errors.some((message) => message.includes("no runtime for game"))).toBe(true);
    expect(isolatedLobby.isReady()).toBe(true);
  } finally {
    await isolatedLobby.close();
    await isolated.close();
    await withoutRuntime.close();
  }
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await server.close();
  await database.close();
  const cleanup = createDatabaseClient(databaseUrl);
  const rooms = await cleanup.room.findMany({ where: { number: { in: [FAKE_ROOM, BAD_ROOM, QUIZ_ROOM] } } });
  const roomIds = rooms.map((room) => room.id);
  const sessions = await cleanup.gameSession.findMany({ where: { roomId: { in: roomIds }, createdAt: { gte: startedAt } }, select: { id: true } }); // only what this run created
  const sessionIds = sessions.map((session) => session.id);
  await cleanup.room.updateMany({ where: { id: { in: roomIds } }, data: { status: "OPEN", currentSessionId: null } });
  await cleanup.quizMatchState.deleteMany({ where: { matchId: { in: sessionIds } } });
  await cleanup.matchParticipant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
  await cleanup.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
  await cleanup.room.deleteMany({ where: { number: { in: [FAKE_ROOM, BAD_ROOM] } } });
  await cleanup.organizerSession.deleteMany({ where: { ownerId: { in: accountIds } } });
  await cleanup.organizer.deleteMany({ where: { id: { in: accountIds } } });
  await cleanup.$disconnect();
  const redis = createRedisClient({ url: redisUrl });
  await redis.connect();
  const keys = (await Promise.all([FAKE_ROOM, BAD_ROOM, QUIZ_ROOM].map((number) => redis.keys(`quizarena:room:presence:${number}:*`)))).flat();
  if (keys.length) await redis.del(keys);
  await redis.disconnect();
});
