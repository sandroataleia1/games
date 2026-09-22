import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as createClient } from "socket.io-client";
import { createDatabase } from "@quizarena/database";
import { createClient as createDatabaseClient } from "../../../packages/database/src/client.js";
import { EVENTS } from "@quizarena/contracts";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const databases = [];
const runtimes = [];
const servers = [];
const clients = [];
const createdRoomCodes = [];

async function instance(port) {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }) });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: "quizarena:test:rate:lobby" });
  server.setLobby(lobby);
  await lobby.connect();
  await new Promise((resolve) => server.httpServer.listen(port, resolve));
  databases.push(database);
  runtimes.push(lobby);
  servers.push(server);
  return server;
}

function connect(port) {
  const client = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
  clients.push(client);
  return new Promise((resolve, reject) => { client.once("connect", () => resolve(client)); client.once("connect_error", reject); });
}

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}

test("host and player on separate instances share lobby state through Redis", async () => {
  const quizDatabase = createDatabase({ databaseUrl });
  const quiz = (await quizDatabase.quizzes.listByStatus("PUBLISHED"))[0];
  await quizDatabase.close();
  expect(quiz).toBeTruthy();
  await instance(0);
  await instance(0);
  const host = await connect(servers[0].httpServer.address().port);
  const player = await connect(servers[1].httpServer.address().port);
  const created = await command(host, EVENTS.ROOM_CREATE, { quizId: quiz.id });
  expect(created.ok).toBe(true);
  createdRoomCodes.push(created.data.roomCode);
  const state = new Promise((resolve) => host.once(EVENTS.ROOM_STATE, resolve));
  const joined = await command(player, EVENTS.ROOM_JOIN, { roomCode: created.data.roomCode, displayName: "Ana" });
  expect(joined.ok).toBe(true);
  expect((await state).playerCount).toBe(1);
  expect(joined.data.state.players[0].displayName).toBe("Ana");
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(databases.map((database) => database.close()));
  const cleanup = createDatabaseClient(databaseUrl);
  for (const roomCode of createdRoomCodes) {
    const session = await cleanup.gameSession.findUnique({ where: { roomCode }, select: { id: true } });
    if (session) {
      await cleanup.participant.deleteMany({ where: { gameSessionId: session.id } });
      await cleanup.gameSession.delete({ where: { id: session.id } });
    }
  }
  await cleanup.$disconnect();
});
