import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as connectClient } from "socket.io-client";
import { createClient as createRedisClient } from "redis";
import { createDatabase } from "@quizarena/database";
import { createClient as createDatabaseClient } from "../../../packages/database/src/client.js";
import { EVENTS } from "@quizarena/contracts";
import { createRealtimeServer } from "../src/server.js";
import { createLobbyRuntime } from "../src/lobby.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const resources = [];
const clients = [];
const playerAccountIds = [];
const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ROOM_A = 3;
const ROOM_B = 4;

async function instance() {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: `quizarena:test:rate:distributed:${testRunId}:${resources.length}` });
  server.setLobby(lobby);
  await lobby.connect();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const resource = { database, server, lobby, port: server.httpServer.address().port };
  resources.push(resource);
  return resource;
}

async function client(port, token) {
  const socket = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(socket);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
}

function command(socket, event, payload) {
  return new Promise((resolve) => socket.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}
function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve) => {
    const handler = (payload) => { if (predicate(payload)) { socket.off(event, handler); resolve(payload); } };
    socket.on(event, handler);
  });
}
async function shortenQuestion(sessionId, milliseconds = 250) {
  const client = createDatabaseClient(databaseUrl);
  await client.gameSession.update({ where: { id: sessionId }, data: { questionEndsAt: new Date(Date.now() + milliseconds) } });
  await client.$disconnect();
}
async function resetRoom(number) {
  const client = createDatabaseClient(databaseUrl);
  const room = await client.room.findUnique({ where: { number } });
  if (room) {
    const sessions = await client.gameSession.findMany({ where: { roomId: room.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    await client.answer.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.participant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.matchParticipant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
    await client.room.update({ where: { id: room.id }, data: { status: "OPEN", quizId: null, currentSessionId: null } });
    await client.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  await client.$disconnect();
}
async function cleanup() {
  clients.forEach((socket) => socket.close());
  await Promise.all(resources.map(({ server }) => server.close()));
  await resetRoom(ROOM_A);
  await resetRoom(ROOM_B);
  const client = createDatabaseClient(databaseUrl);
  if (playerAccountIds.length) { await client.organizerSession.deleteMany({ where: { ownerId: { in: playerAccountIds } } }); await client.organizer.deleteMany({ where: { id: { in: playerAccountIds } } }); }
  await client.$disconnect();
  await Promise.all(resources.map(({ database }) => database.close()));

  // Presence keys carry a multi-hour TTL; clear them so a leftover entry
  // from this run never leaks into another test's playerCount assertions.
  const redis = createRedisClient({ url: redisUrl });
  await redis.connect();
  const keys = (await Promise.all([ROOM_A, ROOM_B].map((number) => redis.keys(`quizarena:room:presence:${number}:*`)))).flat();
  if (keys.length) await redis.del(keys);
  await redis.disconnect();
}

test("full match lifecycle crosses instances and recovers its timer", async () => {
  const instanceA = await instance();
  const instanceB = await instance();
  const auth = await instanceA.database.organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const distribuido = await instanceA.database.organizers.register({ name: "Distribuido", email: `distribuido-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  playerAccountIds.push(distribuido.user.id);
  const host = await client(instanceA.port, auth.token);
  const player = await client(instanceB.port, distribuido.token);
  const counts = { host: {}, player: {} };
  const received = { host: {}, player: {} };
  function countEvents(label, socket) {
    for (const event of [EVENTS.GAME_QUESTION, EVENTS.GAME_QUESTION_RESULT, EVENTS.GAME_RANKING, EVENTS.GAME_FINISHED]) {
      counts[label][event] ??= 0;
      received[label][event] ??= [];
      socket.on(event, (payload) => { counts[label][event] += 1; received[label][event].push(payload); });
    }
  }
  countEvents("host", host);
  countEvents("player", player);
  const quiz = (await instanceA.database.organizers.publishedOwned(auth.user.id))[0];

  expect((await command(host, EVENTS.ROOM_ENTER, { roomNumber: ROOM_A })).ok).toBe(true);
  expect((await command(player, EVENTS.ROOM_ENTER, { roomNumber: ROOM_A })).ok).toBe(true);
  expect((await command(host, EVENTS.THEME_SELECT, { roomNumber: ROOM_A, quizId: quiz.id })).ok).toBe(true);

  const questionOnB = waitFor(player, EVENTS.GAME_QUESTION);
  const resultOnA = waitFor(host, EVENTS.GAME_QUESTION_RESULT);
  const resultOnB = waitFor(player, EVENTS.GAME_QUESTION_RESULT);
  const started = await command(player, EVENTS.MATCH_START, { roomNumber: ROOM_A });
  expect(started.ok).toBe(true);
  const sessionId = (await instanceA.database.rooms.get(ROOM_A)).currentSessionId;
  const question = await questionOnB;
  expect(question).not.toHaveProperty("isCorrect");
  expect(question).not.toHaveProperty("explanation");
  expect(JSON.stringify(question)).not.toContain("Token");
  await shortenQuestion(sessionId);
  await instanceA.lobby.recoverActiveMatches();
  await instanceB.lobby.recoverActiveMatches();
  const answer = await command(player, EVENTS.GAME_ANSWER, { roomNumber: ROOM_A, questionId: question.id, optionId: question.options[0].id });
  expect(answer.ok).toBe(true);
  const duplicate = await command(player, EVENTS.GAME_ANSWER, { roomNumber: ROOM_A, questionId: question.id, optionId: question.options[0].id });
  expect(duplicate.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  const resultA = await resultOnA;
  const resultB = await resultOnB;
  expect(resultA.ranking).toEqual(resultB.ranking);
  expect(resultA).not.toHaveProperty("answers");

  // Both accounts entered before the match started, so both are legitimate
  // participants; racing GAME_NEXT from two distinct connections/instances
  // exercises the distributed lock - only one may succeed.
  const questionEventsBeforeAdvance = { host: counts.host[EVENTS.GAME_QUESTION], player: counts.player[EVENTS.GAME_QUESTION] };
  const nextResults = await Promise.all([
    command(host, EVENTS.GAME_NEXT, { roomNumber: ROOM_A }),
    command(player, EVENTS.GAME_NEXT, { roomNumber: ROOM_A }),
  ]);
  expect(nextResults.filter((result) => result.ok)).toHaveLength(1);
  expect(nextResults.filter((result) => !result.ok && result.error.code === "INVALID_STATE")).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(counts.host[EVENTS.GAME_QUESTION] - questionEventsBeforeAdvance.host).toBe(1);
  expect(counts.player[EVENTS.GAME_QUESTION] - questionEventsBeforeAdvance.player).toBe(1);
  const current = await instanceA.database.sessions.getById(sessionId);
  expect(current.currentQuestionIndex).toBe(1);
  const successfulNext = nextResults.find((result) => result.ok);
  expect(successfulNext.data.match.question.id).toBe(current.quizSnapshot.questions[1].id);
  expect(successfulNext.data.match.question.startedAt).toBe(current.questionStartedAt.toISOString());
  expect(successfulNext.data.match.question.endsAt).toBe(current.questionEndsAt.toISOString());

  const resumedSocket = player;
  resumedSocket.close();
  const replacement = await client(instanceA.port, distribuido.token);
  countEvents("player", replacement);
  const resumed = await command(replacement, EVENTS.ROOM_ENTER, { roomNumber: ROOM_A });
  expect(resumed.ok).toBe(true);
  expect(resumed.data.playing).toBe(true);
  expect(resumed.data.match.round).toBe(2);
  expect(resumed.data.match.phase).toBe("QUESTION");
  expect(received.host[EVENTS.GAME_QUESTION].map(({ round }) => round)).toEqual([1, 2]);
  const secondQuestion = resumed.data.match.question;
  const lateRoom = waitFor(replacement, EVENTS.GAME_QUESTION_RESULT);
  await shortenQuestion(sessionId, 150);
  await instanceA.lobby.recoverActiveMatches();
  await instanceB.lobby.recoverActiveMatches();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await lateRoom;
  expect(received.host[EVENTS.GAME_QUESTION].map(({ round }) => round)).toEqual([1, 2]);
  const lateAnswer = await command(replacement, EVENTS.GAME_ANSWER, { roomNumber: ROOM_A, questionId: secondQuestion.id, optionId: secondQuestion.options[0].id });
  expect(lateAnswer.ok).toBe(false);
  for (let round = 2; round <= 6; round += 1) {
    const active = await instanceA.database.sessions.getById(sessionId);
    if (active.matchPhase === "QUESTION") await instanceA.database.sessions.questionResult(sessionId);
    await command(host, EVENTS.GAME_NEXT, { roomNumber: ROOM_A });
  }
  const finished = await instanceA.database.sessions.getById(sessionId);
  expect(finished.matchPhase).toBe("FINISHED");
  const afterFinish = await command(replacement, EVENTS.GAME_ANSWER, { roomNumber: ROOM_A, questionId: secondQuestion.id, optionId: secondQuestion.options[0].id });
  expect(afterFinish.ok).toBe(false);
  expect(received.host[EVENTS.GAME_QUESTION].map(({ round }) => round)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(received.player[EVENTS.GAME_QUESTION].map(({ round }) => round)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(counts.host[EVENTS.GAME_QUESTION_RESULT]).toBe(2);
  expect(counts.player[EVENTS.GAME_QUESTION_RESULT]).toBe(2);
  expect(counts.host[EVENTS.GAME_RANKING]).toBe(3);
  expect(counts.player[EVENTS.GAME_RANKING]).toBe(3);
  expect(counts.host[EVENTS.GAME_FINISHED]).toBe(1);
  expect(counts.player[EVENTS.GAME_FINISHED]).toBe(1);

  const reopened = await instanceA.database.rooms.get(ROOM_A);
  expect(reopened.status).toBe("OPEN");
});

test("two database connections reject concurrent start transitions", async () => {
  const instanceA = resources[0] || await instance();
  const auth = await instanceA.database.organizers.login({ email: "organizador@quizarena.local", password: "QuizArena2026" });
  const concorrente = await instanceA.database.organizers.register({ name: "Concorrente", email: `concorrente-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  playerAccountIds.push(concorrente.user.id);
  const host = await client(instanceA.port, auth.token);
  const quiz = (await instanceA.database.organizers.publishedOwned(auth.user.id))[0];
  expect((await command(host, EVENTS.ROOM_ENTER, { roomNumber: ROOM_B })).ok).toBe(true);
  await command(host, EVENTS.THEME_SELECT, { roomNumber: ROOM_B, quizId: quiz.id });
  const joinedSocket = await client(instanceA.port, concorrente.token);
  const joined = await command(joinedSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM_B });
  expect(joined.ok).toBe(true);
  const created = await instanceA.database.rooms.startMatch(ROOM_B, [
    { userId: auth.user.id, displayName: auth.user.name },
    { userId: concorrente.user.id, displayName: concorrente.user.name },
  ]);
  const databaseB = createDatabase({ databaseUrl });
  const outcomes = await Promise.allSettled([instanceA.database.sessions.startMatch(created.id), databaseB.sessions.startMatch(created.id)]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  await databaseB.close();
});

afterAll(cleanup);
