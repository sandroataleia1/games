import { config } from "dotenv";
import { afterAll, expect, test } from "vitest";
import { io as connectClient } from "socket.io-client";
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
const roomCodes = [];
const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function instance() {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }) });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: `quizarena:test:rate:distributed:${testRunId}:${resources.length}` });
  server.setLobby(lobby);
  await lobby.connect();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const resource = { database, server, lobby, port: server.httpServer.address().port };
  resources.push(resource);
  return resource;
}

async function client(port) {
  const socket = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
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
async function shortenQuestion(roomCode, milliseconds = 250) {
  const client = createDatabaseClient(databaseUrl);
  const session = await client.gameSession.findUnique({ where: { roomCode } });
  await client.gameSession.update({ where: { id: session.id }, data: { questionEndsAt: new Date(Date.now() + milliseconds) } });
  await client.$disconnect();
}
async function cleanup() {
  clients.forEach((socket) => socket.close());
  await Promise.all(resources.map(({ server }) => server.close()));
  const client = createDatabaseClient(databaseUrl);
  for (const roomCode of roomCodes) {
    const session = await client.gameSession.findUnique({ where: { roomCode }, select: { id: true } });
    if (session) {
      await client.answer.deleteMany({ where: { gameSessionId: session.id } });
      await client.participant.deleteMany({ where: { gameSessionId: session.id } });
      await client.gameSession.delete({ where: { id: session.id } });
    }
  }
  await client.$disconnect();
  await Promise.all(resources.map(({ database }) => database.close()));
}

test("full match lifecycle crosses instances and recovers its timer", async () => {
  const instanceA = await instance();
  const instanceB = await instance();
  const host = await client(instanceA.port);
  const player = await client(instanceB.port);
  const counts = { host: {}, player: {} };
  function countEvents(label, socket) {
    for (const event of [EVENTS.GAME_QUESTION, EVENTS.GAME_QUESTION_RESULT, EVENTS.GAME_RANKING, EVENTS.GAME_FINISHED]) {
      counts[label][event] ??= 0;
      socket.on(event, () => { counts[label][event] += 1; });
    }
  }
  countEvents("host", host);
  countEvents("player", player);
  const quiz = (await instanceA.database.quizzes.listByStatus("PUBLISHED"))[0];
  const created = await command(host, EVENTS.ROOM_CREATE, { quizId: quiz.id });
  expect(created.ok).toBe(true);
  const roomCode = created.data.roomCode;
  roomCodes.push(roomCode);
  const joined = await command(player, EVENTS.ROOM_JOIN, { roomCode, displayName: "Distribuido" });
  expect(joined.ok).toBe(true);
  const questionOnB = waitFor(player, EVENTS.GAME_QUESTION);
  const resultOnA = waitFor(host, EVENTS.GAME_QUESTION_RESULT);
  const resultOnB = waitFor(player, EVENTS.GAME_QUESTION_RESULT);
  const started = await command(host, EVENTS.GAME_START, { roomCode });
  expect(started.ok).toBe(true);
  const question = await questionOnB;
  expect(question).not.toHaveProperty("isCorrect");
  expect(question).not.toHaveProperty("explanation");
  expect(JSON.stringify(question)).not.toContain("Token");
  await shortenQuestion(roomCode);
  await instanceA.lobby.recoverActiveMatches();
  await instanceB.lobby.recoverActiveMatches();
  const answer = await command(player, EVENTS.GAME_ANSWER, { roomCode, questionId: question.id, optionId: question.options[0].id });
  expect(answer.ok).toBe(true);
  const duplicate = await command(player, EVENTS.GAME_ANSWER, { roomCode, questionId: question.id, optionId: question.options[0].id });
  expect(duplicate.error.code).toBe("ANSWER_ALREADY_SUBMITTED");
  const resultA = await resultOnA;
  const resultB = await resultOnB;
  expect(resultA.ranking).toEqual(resultB.ranking);
  expect(resultA).not.toHaveProperty("answers");
  const session = await instanceA.database.sessions.getByCode(roomCode);
  const nextResults = await Promise.allSettled([instanceA.database.sessions.nextQuestion(session.id), instanceB.database.sessions.nextQuestion(session.id)]);
  expect(nextResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(nextResults.filter((result) => result.status === "rejected")).toHaveLength(1);
  const current = await instanceA.database.sessions.getByCode(roomCode);
  expect(current.currentQuestionIndex).toBe(1);
  const resumedSocket = player;
  resumedSocket.close();
  const replacement = await client(instanceA.port);
  countEvents("player", replacement);
  const resumed = await command(replacement, EVENTS.ROOM_RESUME, { roomCode, participantId: joined.data.participantId, reconnectToken: joined.data.reconnectToken });
  expect(resumed.ok).toBe(true);
  expect(resumed.data.match.round).toBe(2);
  expect(resumed.data.match.phase).toBe("QUESTION");
  const secondQuestion = resumed.data.match.question;
  const lateRoom = waitFor(replacement, EVENTS.GAME_QUESTION_RESULT);
  await shortenQuestion(roomCode, 150);
  await instanceA.lobby.recoverActiveMatches();
  await instanceB.lobby.recoverActiveMatches();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await lateRoom;
  const lateAnswer = await command(replacement, EVENTS.GAME_ANSWER, { roomCode, questionId: secondQuestion.id, optionId: secondQuestion.options[0].id });
  expect(lateAnswer.ok).toBe(false);
  for (let round = 2; round <= 6; round += 1) {
    const active = await instanceA.database.sessions.getByCode(roomCode);
    if (active.matchPhase === "QUESTION") await instanceA.database.sessions.questionResult(active.id);
    if (round < 6) await command(host, EVENTS.GAME_NEXT, { roomCode });
    else await command(host, EVENTS.GAME_NEXT, { roomCode });
  }
  const finished = await instanceA.database.sessions.getByCode(roomCode);
  expect(finished.matchPhase).toBe("FINISHED");
  const afterFinish = await command(replacement, EVENTS.GAME_ANSWER, { roomCode, questionId: secondQuestion.id, optionId: secondQuestion.options[0].id });
  expect(afterFinish.ok).toBe(false);
  expect(counts.host[EVENTS.GAME_QUESTION]).toBe(6);
  expect(counts.player[EVENTS.GAME_QUESTION]).toBe(5);
  expect(counts.host[EVENTS.GAME_QUESTION_RESULT]).toBe(2);
  expect(counts.player[EVENTS.GAME_QUESTION_RESULT]).toBe(2);
  expect(counts.host[EVENTS.GAME_RANKING]).toBe(3);
  expect(counts.player[EVENTS.GAME_RANKING]).toBe(3);
  expect(counts.host[EVENTS.GAME_FINISHED]).toBe(1);
  expect(counts.player[EVENTS.GAME_FINISHED]).toBe(1);
});

test("two database connections reject concurrent start transitions", async () => {
  const instanceA = resources[0] || await instance();
  const host = await client(instanceA.port);
  const quiz = (await instanceA.database.quizzes.listByStatus("PUBLISHED"))[0];
  const created = await command(host, EVENTS.ROOM_CREATE, { quizId: quiz.id });
  const roomCode = created.data.roomCode;
  roomCodes.push(roomCode);
  const joinedSocket = await client(instanceA.port);
  const joined = await command(joinedSocket, EVENTS.ROOM_JOIN, { roomCode, displayName: "Concorrente" });
  const session = await instanceA.database.sessions.getByCode(roomCode);
  const databaseB = createDatabase({ databaseUrl });
  const outcomes = await Promise.allSettled([instanceA.database.sessions.startMatch(session.id), databaseB.sessions.startMatch(session.id)]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  await databaseB.close();
  expect(joined.ok).toBe(true);
});

afterAll(cleanup);
