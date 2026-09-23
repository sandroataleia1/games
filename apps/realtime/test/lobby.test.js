import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as createClient } from "socket.io-client";
import { createClient as createRedisClient } from "redis";
import { createServerDatabase as createDatabase } from "@multygames/server-bootstrap";
import { createClient as createDatabaseClient } from "../../../packages/database/src/client.js";
import { EVENTS } from "@quizarena/contracts";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const databases = [];
const servers = [];
const clients = [];
const ROOM = 2;
let playerAccountId;

async function instance(port) {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: "quizarena:test:rate:lobby" });
  server.setLobby(lobby);
  await lobby.connect();
  await new Promise((resolve) => server.httpServer.listen(port, resolve));
  databases.push(database);
  servers.push(server);
  return server;
}

function connect(port, token) {
  const client = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  return new Promise((resolve, reject) => { client.once("connect", () => resolve(client)); client.once("connect_error", reject); });
}

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}

test("room presence and theme selection are shared across instances through Redis", async () => {
  await instance(0);
  await instance(0);
  const auth = await databases[0].organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const quiz = (await databases[0].organizers.publishedOwned(auth.user.id))[0];
  expect(quiz).toBeTruthy();
  const ana = await databases[0].organizers.register({ name: "Ana", email: `ana-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  playerAccountId = ana.user.id;

  const host = await connect(servers[0].httpServer.address().port, auth.token);
  const player = await connect(servers[1].httpServer.address().port);
  const unauthenticated = await command(player, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(unauthenticated.error.code).toBe("UNAUTHENTICATED");

  const enteredHost = await command(host, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(enteredHost.ok).toBe(true);
  const themed = await command(host, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  expect(themed.ok).toBe(true);

  const stateOnHost = new Promise((resolve) => host.once(EVENTS.ROOM_STATE, resolve));
  const authenticatedPlayer = await connect(servers[1].httpServer.address().port, ana.token);
  const entered = await command(authenticatedPlayer, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(entered.ok).toBe(true);
  expect(entered.data.room.quizId).toBe(quiz.id);
  expect((await stateOnHost).playerCount).toBe(2);
  expect(entered.data.room.players.map((p) => p.displayName)).toContain("Ana");
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(databases.map((database) => database.close()));
  const cleanup = createDatabaseClient(databaseUrl);
  const room = await cleanup.room.findUnique({ where: { number: ROOM } });
  if (room) await cleanup.room.update({ where: { id: room.id }, data: { status: "OPEN", quizId: null, currentSessionId: null } });
 await cleanup.quizRoomConfiguration.deleteMany({ where: { roomId: room.id } });
  if (playerAccountId) { await cleanup.organizerSession.deleteMany({ where: { ownerId: playerAccountId } }); await cleanup.organizer.delete({ where: { id: playerAccountId } }); }
  await cleanup.$disconnect();

  // Presence keys carry a multi-hour TTL, so a leftover from a previous run
  // (a random account that no longer exists) would silently inflate the
  // exact playerCount assertion above on the next run.
  const redis = createRedisClient({ url: redisUrl });
  await redis.connect();
  const keys = await redis.keys(`quizarena:room:presence:${ROOM}:*`);
  if (keys.length) await redis.del(keys);
  await redis.disconnect();
});
