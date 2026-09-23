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
const accountIds = [];
const usedRooms = [];

async function instance(options = {}) {
  const database = createDatabase({ databaseUrl });
  const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database });
  const lobby = createLobbyRuntime({ io: server.io, database, redisUrl, rateLimitPrefix: `quizarena:test:rate:portal:${randomUUID()}`, ...options });
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
async function twoQuestionQuizWithShortRounds(database, ownerId) {
  let quiz = await database.organizers.createQuiz(ownerId, { title: `Quiz curto ${randomUUID()}`, description: null });
  quiz = await database.organizers.addQuestion(ownerId, quiz.id, { prompt: "Pergunta 1", durationSeconds: 5, basePoints: 1000, explanation: null, options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
  quiz = await database.organizers.addQuestion(ownerId, quiz.id, { prompt: "Pergunta 2", durationSeconds: 5, basePoints: 1000, explanation: null, options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
  return database.organizers.publish(ownerId, quiz.id);
}
function nextRoom() {
  const number = 5 + usedRooms.length;
  usedRooms.push(number);
  return number;
}

test("visitante sem conta não lista, não entra, não escolhe tema e não inicia partida", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const author = await account(database, "Autor");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const visitor = await connect(port);
  expect((await command(visitor, EVENTS.QUIZ_LIST, {})).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.ROOM_LIST, {})).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id })).error.code).toBe("UNAUTHENTICATED");
  expect((await command(visitor, EVENTS.MATCH_START, { roomNumber: ROOM })).error.code).toBe("UNAUTHENTICATED");
});

test("qualquer conta autenticada escolhe o tema com o quiz publicado de outra conta", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const author = await account(database, "Editora");
  const other = await account(database, "Convidada");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const otherSocket = await connect(port, other.token);
  const quizzesForOther = await command(otherSocket, EVENTS.QUIZ_LIST, {});
  expect(quizzesForOther.data.quizzes.some((item) => item.id === quiz.id)).toBe(true);
  expect((await command(otherSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  const themed = await command(otherSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  expect(themed.ok).toBe(true);
  expect(themed.data.room.quizId).toBe(quiz.id);
  const list = await command(otherSocket, EVENTS.ROOM_LIST, {});
  const entry = list.data.rooms.find((room) => room.number === ROOM);
  expect(entry).toMatchObject({ number: ROOM, status: "OPEN", quizId: quiz.id, playerCount: 1 });
});

test("v1:room:index transmite em tempo real quando uma sala muda de status", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const author = await account(database, "IndexAuthor");
  const quiz = await onePublishedQuiz(database, author.user.id);
  const authorSocket = await connect(port, author.token);
  const watcherAccount = await account(database, "IndexWatcher");
  const watcherSocket = await connect(port, watcherAccount.token);
  const watchAck = await command(watcherSocket, EVENTS.ROOM_LIST, {});
  expect(watchAck.ok).toBe(true);

  const seenIndexUpdates = [];
  watcherSocket.on(EVENTS.ROOM_INDEX, (update) => seenIndexUpdates.push(update));
  expect((await command(authorSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  const themed = await command(authorSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  expect(themed.ok).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(seenIndexUpdates.length).toBeGreaterThanOrEqual(2);
  const entry = seenIndexUpdates.at(-1).rooms.find((room) => room.number === ROOM);
  expect(entry.quizId).toBe(quiz.id);
  expect(entry.playerCount).toBe(1);
});

test("uma conta sozinha na sala inicia a partida, joga e vence sua própria partida solo", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const host = await account(database, "HostSolo");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  expect((await command(hostSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  expect((await command(hostSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id })).ok).toBe(true);

  const question = waitFor(hostSocket, EVENTS.GAME_QUESTION);
  const started = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  const seenQuestion = await question;
  const answer = await command(hostSocket, EVENTS.GAME_ANSWER, { roomNumber: ROOM, questionId: seenQuestion.id, optionId: seenQuestion.options[0].id });
  expect(answer.ok).toBe(true);
  // The only participant answered, so the result is already showing - no
  // waiting for the question's deadline.
  const room = await database.rooms.get(ROOM);
  expect((await database.sessions.getById(room.currentSessionId)).matchPhase).toBe("QUESTION_RESULT");
  const finished = await command(hostSocket, EVENTS.GAME_NEXT, { roomNumber: ROOM });
  expect(finished.ok).toBe(true);
  expect(finished.data.finished).toBe(true);
  expect(finished.data.ranking).toHaveLength(1);
  expect(finished.data.ranking[0].displayName).toBe(host.user.name);
  expect((await database.rooms.get(ROOM)).status).toBe("OPEN");
});

test("sair da sala jogando sozinho finaliza a partida e reabre a sala, sem precisar avançar até o fim", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const host = await account(database, "SolitarioSai");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  expect((await command(hostSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  await command(hostSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  const started = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  expect((await database.rooms.get(ROOM)).status).toBe("PLAYING");

  const left = await command(hostSocket, EVENTS.ROOM_LEAVE, { roomNumber: ROOM });
  expect(left.ok).toBe(true);
  const afterLeave = await database.rooms.get(ROOM);
  expect(afterLeave.status).toBe("OPEN");
  expect(afterLeave.currentSessionId).toBeNull();
});

test("jogador que reconecta em outro socket não perde a participação e ainda avança a partida", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const host = await account(database, "Reconecta");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const firstSocket = await connect(port, host.token);
  expect((await command(firstSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  await command(firstSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  const started = await command(firstSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  firstSocket.close();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const secondSocket = await connect(port, host.token);
  const resumed = await command(secondSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM });
  expect(resumed.ok).toBe(true);
  expect(resumed.data.playing).toBe(true);
  const answer = await command(secondSocket, EVENTS.GAME_ANSWER, { roomNumber: ROOM, questionId: resumed.data.match.question.id, optionId: resumed.data.match.question.options[0].id });
  expect(answer.ok).toBe(true);
});

test("uma partida abandonada avança e termina sozinha depois de um tempo sem interação", async () => {
  const { database, port } = await instance({ resultAdvanceMs: 300 });
  const ROOM = nextRoom();
  const host = await account(database, "Abandonado");
  const quiz = await twoQuestionQuizWithShortRounds(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  expect((await command(hostSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  await command(hostSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });

  const stateUpdates = [];
  hostSocket.on(EVENTS.GAME_STATE, (state) => stateUpdates.push(state));
  const started = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  expect(started.data.match.round).toBe(1);

  // Nobody answers and nobody ever clicks "Avançar": the question's own
  // deadline (5s) moves it to QUESTION_RESULT, then the idle timer (300ms)
  // advances to round 2, then the same idle timer finishes the match.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  expect(stateUpdates.some((state) => state.phase === "QUESTION" && state.round === 2)).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 6000));
  expect((await database.rooms.get(ROOM)).status).toBe("OPEN");
}, 20000);

test("iniciar sem tema falha com QUIZ_NOT_PUBLISHED e iniciar uma sala já em partida falha com ROOM_NOT_WAITING", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const host = await account(database, "SemTema");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  expect((await command(hostSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);

  const withoutTheme = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(withoutTheme.ok).toBe(false);
  expect(withoutTheme.error.code).toBe("QUIZ_NOT_PUBLISHED");

  await command(hostSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  const started = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  const startedAgain = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(startedAgain.ok).toBe(false);
  expect(startedAgain.error.code).toBe("ROOM_NOT_WAITING");
  const room = await database.rooms.get(ROOM);
  await database.sessions.questionResult(room.currentSessionId);
  await command(hostSocket, EVENTS.GAME_NEXT, { roomNumber: ROOM });
});

test("sair da sala depois que a partida termina não quebra (era erro genérico)", async () => {
  const { database, port } = await instance();
  const ROOM = nextRoom();
  const host = await account(database, "HostSai");
  const guest = await account(database, "ConvidadaSai");
  const quiz = await onePublishedQuiz(database, host.user.id);
  const hostSocket = await connect(port, host.token);
  const guestSocket = await connect(port, guest.token);
  expect((await command(hostSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  expect((await command(guestSocket, EVENTS.ROOM_ENTER, { roomNumber: ROOM })).ok).toBe(true);
  await command(hostSocket, EVENTS.THEME_SELECT, { roomNumber: ROOM, quizId: quiz.id });
  const started = await command(hostSocket, EVENTS.MATCH_START, { roomNumber: ROOM });
  expect(started.ok).toBe(true);
  const question = started.data.match.question;
  await command(guestSocket, EVENTS.GAME_ANSWER, { roomNumber: ROOM, questionId: question.id, optionId: question.options[0].id });
  const room = await database.rooms.get(ROOM);
  await database.sessions.questionResult(room.currentSessionId);
  const finished = await command(hostSocket, EVENTS.GAME_NEXT, { roomNumber: ROOM });
  expect(finished.data.finished).toBe(true);

  const left = await command(guestSocket, EVENTS.ROOM_LEAVE, { roomNumber: ROOM });
  expect(left.ok).toBe(true);
});

afterAll(async () => {
  clients.forEach((client) => client.close());
  await Promise.all(resources.map(({ server }) => server.close()));
  const cleanup = createDatabaseClient(databaseUrl);
  for (const number of usedRooms) {
    const room = await cleanup.room.findUnique({ where: { number } });
    if (room) {
      const sessions = await cleanup.gameSession.findMany({ where: { roomId: room.id }, select: { id: true } });
      const sessionIds = sessions.map((s) => s.id);
      await cleanup.answer.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
      await cleanup.participant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
      await cleanup.matchParticipant.deleteMany({ where: { gameSessionId: { in: sessionIds } } });
      await cleanup.room.update({ where: { id: room.id }, data: { status: "OPEN", quizId: null, currentSessionId: null } });
      await cleanup.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
    }
  }
  if (accountIds.length) {
    await cleanup.quiz.deleteMany({ where: { ownerId: { in: accountIds } } });
    await cleanup.organizerSession.deleteMany({ where: { ownerId: { in: accountIds } } });
    await cleanup.organizer.deleteMany({ where: { id: { in: accountIds } } });
  }
  await cleanup.$disconnect();
  await Promise.all(resources.map(({ database }) => database.close()));

  // Presence keys carry a multi-hour TTL; clear them so a leftover entry
  // from this run never leaks into another test's playerCount assertions.
  if (usedRooms.length) {
    const redis = createRedisClient({ url: redisUrl });
    await redis.connect();
    const keys = (await Promise.all(usedRooms.map((number) => redis.keys(`quizarena:room:presence:${number}:*`)))).flat();
    if (keys.length) await redis.del(keys);
    await redis.disconnect();
  }
});
