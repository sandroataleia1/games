import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as connectClient } from "socket.io-client";
import { createDatabase } from "@quizarena/database";
import { EVENTS } from "@quizarena/contracts";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const database = createDatabase({ databaseUrl });
const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: "quizarena:test:rate:match" });
const clients = [];
let roomCode;

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}

async function connect(port, token) {
  const client = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  return client;
}

test("host starts a question and player answer is evaluated by the server", async () => {
  await lobby.connect();
  server.setLobby(lobby);
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const auth = await database.organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const host = await connect(server.httpServer.address().port, auth.token);
  const player = await connect(server.httpServer.address().port);
  const quiz = (await database.organizers.publishedOwned(auth.user.id))[0];
  const created = await command(host, EVENTS.ROOM_CREATE, { quizId: quiz.id });
  expect(created.ok).toBe(true);
  roomCode = created.data.roomCode;
  const joined = await command(player, EVENTS.ROOM_JOIN, { roomCode, displayName: "Bia" });
  expect(joined.ok).toBe(true);
  const forbidden = await command(player, EVENTS.GAME_START, { roomCode });
  expect(forbidden.error.code).toBe("UNAUTHORIZED");
  const started = await command(host, EVENTS.GAME_START, { roomCode });
  expect(started.ok).toBe(true);
  expect(started.data.match.phase).toBe("QUESTION");
  expect(started.data.match.question.options[0]).not.toHaveProperty("isCorrect");
  const answer = await command(player, EVENTS.GAME_ANSWER, { roomCode, questionId: started.data.match.question.id, optionId: started.data.match.question.options[0].id });
  expect(answer.ok).toBe(true);
  expect(answer.data.answered).toBe(true);
  const duplicate = await command(player, EVENTS.GAME_ANSWER, { roomCode, questionId: started.data.match.question.id, optionId: started.data.match.question.options[0].id });
  expect(duplicate.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  const session = await database.sessions.getByCode(roomCode);
  await database.sessions.questionResult(session.id);
  const next = await command(host, EVENTS.GAME_NEXT, { roomCode });
  expect(next.ok).toBe(true);
  expect(next.data.match.round).toBe(2);
  for (let round = 2; round <= 6; round += 1) {
    const current = await database.sessions.getByCode(roomCode);
    await database.sessions.questionResult(current.id);
    const advanced = await command(host, EVENTS.GAME_NEXT, { roomCode });
    expect(advanced.ok).toBe(true);
    if (round < 6) expect(advanced.data.match.round).toBe(round + 1);
    else expect(advanced.data.finished).toBe(true);
  }
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await server.close();
  if (roomCode) {
    const cleanup = await database.sessions.getByCode(roomCode);
    if (cleanup) {
      const client = (await import("../../../packages/database/src/client.js")).createClient(databaseUrl);
      await client.answer.deleteMany({ where: { gameSessionId: cleanup.id } });
      await client.participant.deleteMany({ where: { gameSessionId: cleanup.id } });
      await client.gameSession.delete({ where: { id: cleanup.id } });
      await client.$disconnect();
    }
  }
  await database.close();
});
