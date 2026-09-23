import { randomUUID } from "node:crypto";
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
const ROOM = 1;
let playerAccountId;

async function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}

async function connect(port, token) {
  const client = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  return client;
}

test("a room's theme is chosen, any present player can start it, and the server evaluates answers", async () => {
  await lobby.connect();
  server.setLobby(lobby);
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const auth = await database.organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const bia = await database.organizers.register({ name: "Bia", email: `bia-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  playerAccountId = bia.user.id;
  const host = await connect(server.httpServer.address().port, auth.token);
  const player = await connect(server.httpServer.address().port, bia.token);
  const quiz = (await database.organizers.publishedOwned(auth.user.id))[0];

  const enteredHost = await command(host, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(enteredHost.ok).toBe(true);
  const enteredPlayer = await command(player, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(enteredPlayer.ok).toBe(true);

  const themed = await command(host, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  expect(themed.ok).toBe(true);
  expect(themed.data.room.quizId).toBe(quiz.id);

  // Host picks the theme then leaves before the match starts - only the
  // remaining player becomes a participant and gets match control.
  const hostLeft = await command(host, EVENTS.ROOM_LEAVE, { roomNumber: ROOM });
  expect(hostLeft.ok).toBe(true);

  // Any player present can start - not just whoever picked the theme.
  const started = await command(player, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  expect(started.data.match.phase).toBe("QUESTION");
  expect(started.data.match.question.options[0]).not.toHaveProperty("isCorrect");

  const answer = await command(player, EVENTS.GAME_ANSWER, { roomNumber: ROOM, questionId: started.data.match.question.id, optionId: started.data.match.question.options[0].id });
  expect(answer.ok).toBe(true);
  expect(answer.data.answered).toBe(true);
  const duplicate = await command(player, EVENTS.GAME_ANSWER, { roomNumber: ROOM, questionId: started.data.match.question.id, optionId: started.data.match.question.options[0].id });
  // The lone participant already answered, so the round closed immediately.
  expect(duplicate.error.code).toBe("INVALID_STATE");

  // A non-participant (host never became a player here) cannot advance the round.
  const forbidden = await command(host, EVENTS.GAME_NEXT, { roomNumber: ROOM });
  expect(forbidden.error.code).toBe("UNAUTHORIZED");
  expect(forbidden.error.message).not.toBe("Não foi possível concluir a operação.");

  const roomAfterStart = await database.rooms.get(ROOM);
  expect((await database.sessions.getById(roomAfterStart.currentSessionId)).matchPhase).toBe("QUESTION_RESULT");
  const next = await command(player, EVENTS.GAME_NEXT, { roomNumber: ROOM });
  expect(next.ok).toBe(true);
  expect(next.data.match.round).toBe(2);

  for (let round = 2; round <= 6; round += 1) {
    const current = await database.rooms.get(ROOM);
    await database.sessions.questionResult(current.currentSessionId);
    const advanced = await command(player, EVENTS.GAME_NEXT, { roomNumber: ROOM });
    expect(advanced.ok).toBe(true);
    if (round < 6) expect(advanced.data.match.round).toBe(round + 1);
    else expect(advanced.data.finished).toBe(true);
  }

  const reopened = await database.rooms.get(ROOM);
  expect(reopened.status).toBe("OPEN");
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await server.close();
  const client = (await import("../../../packages/database/src/client.js")).createClient(databaseUrl);
  const room = await client.room.findUnique({ where: { number: ROOM } });
  if (room) {
    const sessions = await client.gameSession.findMany({ where: { roomId: room.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    await client.answer.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.participant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.matchParticipant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.room.update({ where: { id: room.id }, data: { status: "OPEN", quizId: null, currentSessionId: null } });
    await client.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  if (playerAccountId) { await client.organizerSession.deleteMany({ where: { ownerId: playerAccountId } }); await client.organizer.delete({ where: { id: playerAccountId } }); }
  await client.$disconnect();
  await database.close();
});
