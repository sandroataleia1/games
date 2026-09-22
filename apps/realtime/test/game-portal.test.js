import { randomUUID } from "node:crypto";
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
const accountIds = [];
const roomIds = [];

async function instance() {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: `quizarena:test:rate:portal:${randomUUID()}` });
  server.setLobby(lobby);
  await lobby.connect();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  const resource = { database, server, lobby, port: server.httpServer.address().port };
  resources.push(resource);
  return resource;
}
function connect(port, token) {
  const client = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], extraHeaders: token ? { Cookie: `quizarena_session=${token}` } : undefined });
  clients.push(client);
  return new Promise((resolve, reject) => { client.once("connect", () => resolve(client)); client.once("connect_error", reject); });
}
function command(client, event, payload) {
  return new Promise((resolve) => client.timeout(5000).emit(event, payload, (_error, response) => resolve(response)));
}
function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}
async function account(database, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const result = await database.organizers.register({ name, email: `${slug}-${randomUUID()}@example.com`, password: "SenhaSegura123" });
  accountIds.push(result.user.id);
  return result;
}
async function onePublishedQuiz(database, ownerId) {
  let quiz = await database.organizers.createQuiz(ownerId, { title: `Quiz portal ${randomUUID()}`, description: null });
  quiz = await database.organizers.addQuestion(ownerId, quiz.id, { prompt: "2 + 2?", durationSeconds: 30, basePoints: 1000, explanation: null, options: [{ text: "4", isCorrect: true }, { text: "5", isCorrect: false }] });
  return database.organizers.publish(ownerId, quiz.id);
}

test("visitante sem conta não cria sala, não entra e não lista quizzes ou salas", async () => {
  const { database, port } = await instance();
  const author = await account(database, "Autor");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const visitor = await connect(port);
  expect((await command(visitor, EVENTS.QUIZ_LIST, {})).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.ROOM_CREATE, { quizId: quiz.id })).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.ROOM_LIST, { quizId: quiz.id })).error.code).toBe("UNAUTHENTICATED");
  const authorSocket = await connect(port, author.token);
  const created = await command(authorSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id });
  expect(created.ok).toBe(true);
  roomIds.push(created.data.roomCode);
  expect((await command(visitor, EVENTS.ROOM_JOIN, { roomCode: created.data.roomCode })).error.code).toBe("UNAUTHENTICATED");
});

test("qualquer conta autenticada usa quiz publicado de outra conta e vê salas públicas, não as privadas", async () => {
  const { database, port } = await instance();
  const author = await account(database, "Editora");
  const other = await account(database, "Convidada");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const authorSocket = await connect(port, author.token);
  const otherSocket = await connect(port, other.token);
  const quizzesForOther = await command(otherSocket, EVENTS.QUIZ_LIST, {});
  expect(quizzesForOther.data.quizzes.some((item) => item.id === quiz.id)).toBe(true);
  const publicRoom = await command(authorSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PUBLIC" });
  const privateRoom = await command(authorSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PRIVATE" });
  roomIds.push(publicRoom.data.roomCode, privateRoom.data.roomCode);
  const list = await command(otherSocket, EVENTS.ROOM_LIST, { quizId: quiz.id });
  const codes = list.data.rooms.map((room) => room.roomCode);
  expect(codes).toContain(publicRoom.data.roomCode);
  expect(codes).not.toContain(privateRoom.data.roomCode);
  const joinedPrivate = await command(otherSocket, EVENTS.ROOM_JOIN, { roomCode: privateRoom.data.roomCode });
  expect(joinedPrivate.ok).toBe(true);
});

test("v1:room:watch recebe atualização em tempo real quando uma sala pública surge", async () => {
  const { database, port } = await instance();
  const author = await account(database, "WatcherAuthor");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const authorSocket = await connect(port, author.token);
  const watcherAccount = await account(database, "Watcher");
  const watcherSocket = await connect(port, watcherAccount.token);
  const watchAck = await command(watcherSocket, EVENTS.ROOM_WATCH, { quizId: quiz.id });
  expect(watchAck.ok).toBe(true);
  expect(watchAck.data.rooms).toEqual([]);
  const catalogUpdate = waitFor(watcherSocket, EVENTS.ROOM_CATALOG);
  const created = await command(authorSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PUBLIC" });
  roomIds.push(created.data.roomCode);
  const update = await catalogUpdate;
  expect(update.rooms.map((room) => room.roomCode)).toContain(created.data.roomCode);
});

test("host organiza e joga: partida solo inicia com um participante e o host aparece no ranking final", async () => {
  const { database, port } = await instance();
  const host = await account(database, "HostSolo");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  const created = await command(hostSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PRIVATE", hostPlays: true });
  expect(created.ok).toBe(true);
  expect(created.data.playing).toBe(true);
  roomIds.push(created.data.roomCode);
  expect(created.data.state.playerCount).toBe(1);
  const question = waitFor(hostSocket, EVENTS.GAME_QUESTION);
  const started = await command(hostSocket, EVENTS.GAME_START, { roomCode: created.data.roomCode });
  expect(started.ok).toBe(true);
  const seenQuestion = await question;
  const answer = await command(hostSocket, EVENTS.GAME_ANSWER, { roomCode: created.data.roomCode, questionId: seenQuestion.id, optionId: seenQuestion.options[0].id });
  expect(answer.ok).toBe(true);
  const session = await database.sessions.getByCode(created.data.roomCode);
  await database.sessions.questionResult(session.id);
  const finished = await command(hostSocket, EVENTS.GAME_NEXT, { roomCode: created.data.roomCode });
  expect(finished.ok).toBe(true);
  expect(finished.data.finished).toBe(true);
  expect(finished.data.ranking).toHaveLength(1);
  expect(finished.data.ranking[0].displayName).toBe(host.user.name);
});

test("host jogador que reconecta em outro socket não perde a participação e ainda inicia sozinho", async () => {
  const { database, port } = await instance();
  const host = await account(database, "HostReconecta");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const firstSocket = await connect(port, host.token);
  const created = await command(firstSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PRIVATE", hostPlays: true });
  expect(created.ok).toBe(true);
  roomIds.push(created.data.roomCode);
  firstSocket.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const secondSocket = await connect(port, host.token);
  const resumed = await command(secondSocket, EVENTS.HOST_RESUME, { roomCode: created.data.roomCode, hostToken: created.data.hostToken });
  expect(resumed.ok).toBe(true);
  expect(resumed.data.playing).toBe(true);
  const started = await command(secondSocket, EVENTS.GAME_START, { roomCode: created.data.roomCode });
  expect(started.ok).toBe(true);
});

test("host que escolhe somente organizar não vira jogador e não pode iniciar sozinho", async () => {
  const { database, port } = await instance();
  const host = await account(database, "SomenteOrganizar");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  const created = await command(hostSocket, EVENTS.ROOM_CREATE, { quizId: quiz.id, visibility: "PRIVATE", hostPlays: false });
  expect(created.data.playing).toBe(false);
  expect(created.data.state.playerCount).toBe(0);
  roomIds.push(created.data.roomCode);
  const started = await command(hostSocket, EVENTS.GAME_START, { roomCode: created.data.roomCode });
  expect(started.ok).toBe(false);
  expect(started.error.code).toBe("NO_PARTICIPANTS");
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await Promise.all(resources.map(({ server }) => server.close()));
  const cleanup = createDatabaseClient(databaseUrl);
  for (const roomCode of roomIds) {
    const session = await cleanup.gameSession.findUnique({ where: { roomCode }, select: { id: true } });
    if (session) {
      await cleanup.answer.deleteMany({ where: { gameSessionId: session.id } });
      await cleanup.participant.deleteMany({ where: { gameSessionId: session.id } });
      await cleanup.gameSession.delete({ where: { id: session.id } });
    }
  }
  if (accountIds.length) {
    await cleanup.quiz.deleteMany({ where: { ownerId: { in: accountIds } } });
    await cleanup.organizerSession.deleteMany({ where: { ownerId: { in: accountIds } } });
    await cleanup.organizer.deleteMany({ where: { id: { in: accountIds } } });
  }
  await cleanup.$disconnect();
  await Promise.all(resources.map(({ database }) => database.close()));
});
