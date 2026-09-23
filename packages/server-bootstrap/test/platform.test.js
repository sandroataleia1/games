import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import { createGameRegistry } from "@multygames/game-registry";
import { quizGame } from "@multygames/game-quiz";
import { createServerDatabase as createDatabase } from "../src/index.js";
import { createClient } from "@quizarena/database";
import { syntheticGameModule, createSyntheticRuntime } from "../src/testing.js";
import { QUIZ_GAME_KEY } from "@multygames/game-quiz/server";
import { isolatedTestUrl } from "@quizarena/database/testing";
import { questionInput } from "./fixtures.js";

// Synthetic games exist ONLY in tests - nothing is registered in the app.
const synthetic = syntheticGameModule;
const fake = createSyntheticRuntime("fake-game");
const registry = createGameRegistry([quizGame, synthetic("fake-game", "AVAILABLE"), synthetic("coming-game", "COMING_SOON"), synthetic("old-game", "DISABLED")]);

let client, database, second, ownerId;
const quizIds = [];
const accountIds = [];
const roomNumbers = [];
const sessionIds = new Set();

beforeAll(async () => {
  const url = isolatedTestUrl();
  client = createClient(url);
  database = createDatabase({ databaseUrl: url, catalog: registry, extraRuntimes: [fake.runtime] });
  second = createDatabase({ databaseUrl: url, catalog: registry, extraRuntimes: [fake.runtime] }); // a second "instance"
  ownerId = await account("Dono");
});
afterEach(async () => {
  const ids = [...sessionIds];
  await client.answer.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.quizParticipantState.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.matchParticipant.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.room.updateMany({ where: { currentSessionId: { in: ids } }, data: { status: "OPEN", currentSessionId: null } });
  await client.quizMatchState.deleteMany({ where: { matchId: { in: ids } } });
  await client.gameSession.deleteMany({ where: { id: { in: ids } } });
  sessionIds.clear();
  await client.quizRoomConfiguration.deleteMany({ where: { room: { number: { in: roomNumbers } } } });
  await client.room.updateMany({ where: { number: { in: roomNumbers } }, data: { quizId: null } });
});
afterAll(async () => {
  await client.room.deleteMany({ where: { number: { in: roomNumbers } } });
  await client.quiz.deleteMany({ where: { id: { in: quizIds } } });
  await client.organizerSession.deleteMany({ where: { ownerId: { in: accountIds } } });
  await client.organizer.deleteMany({ where: { id: { in: accountIds } } });
  await Promise.all([client.$disconnect(), database.close(), second.close()]);
});

async function account(name) {
  const id = (await database.organizers.register({ name, email: `${name}-${randomUUID()}@example.com`, password: "SenhaSegura123" })).user.id;
  accountIds.push(id);
  return id;
}
async function publishedQuiz() {
  const quiz = await database.quizzes.createDraft({ title: "Plataforma", ownerId });
  quizIds.push(quiz.id);
  await database.quizzes.addQuestion(quiz.id, questionInput(1));
  await database.quizzes.publish(quiz.id);
  return quiz;
}
let nextRoom = 900;
async function room(gameKey = QUIZ_GAME_KEY) {
  const created = await database.platform.rooms.create({ number: nextRoom++, gameKey });
  roomNumbers.push(created.number);
  return created;
}
async function quizRoom() {
  const created = await room();
  await database.rooms.selectTheme(created.number, (await publishedQuiz()).id);
  return created;
}
function track(match) { sessionIds.add(match.id); return match; }
const entry = (userId, displayName = "Ana") => ({ userId, displayName });

// --- Sala e modalidade -----------------------------------------------------

test("a room is created with a registered, available game and carries its gameKey", async () => {
  const created = await room();
  expect(created).toMatchObject({ gameKey: "quiz", status: "OPEN", currentSessionId: null });
  expect((await database.rooms.get(created.number)).gameKey).toBe("quiz");
});

test("an unknown game cannot get a room", async () => {
  await expect(database.platform.rooms.create({ number: nextRoom++, gameKey: "ghost" })).rejects.toMatchObject({ code: "GAME_UNKNOWN" });
});

test("COMING_SOON and DISABLED games cannot get new rooms", async () => {
  await expect(database.platform.rooms.create({ number: nextRoom++, gameKey: "coming-game" })).rejects.toMatchObject({ code: "GAME_UNAVAILABLE" });
  await expect(database.platform.rooms.create({ number: nextRoom++, gameKey: "old-game" })).rejects.toMatchObject({ code: "GAME_UNAVAILABLE" });
});

test("a duplicate room number is refused by the unique constraint", async () => {
  const created = await room();
  await expect(database.platform.rooms.create({ number: created.number, gameKey: "fake-game" })).rejects.toMatchObject({ code: "ROOM_NUMBER_CONFLICT" });
});

test("rooms can be filtered by game", async () => {
  const quiz = await room();
  const fake = await room("fake-game");
  const quizNumbers = (await database.rooms.list({ gameKey: "quiz" })).map((r) => r.number);
  const fakeNumbers = (await database.rooms.list({ gameKey: "fake-game" })).map((r) => r.number);
  expect(quizNumbers).toContain(quiz.number);
  expect(quizNumbers).not.toContain(fake.number);
  expect(fakeNumbers).toContain(fake.number);
  expect(fakeNumbers).not.toContain(quiz.number);
  expect((await database.rooms.list()).length).toBeGreaterThanOrEqual(2);
});

// --- Vínculo sala -> partida e invariantes no banco -----------------------

test("a match belongs to one room and inherits the room's game", async () => {
  const r = await quizRoom();
  const host = await account("Ana");
  const match = track(await database.rooms.startMatch(r.number, [entry(host)]));
  expect(match.gameKey).toBe("quiz");
  const row = await client.gameSession.findUnique({ where: { id: match.id } });
  expect(row.roomId).toBeTruthy();
  expect((await database.rooms.get(r.number))).toMatchObject({ status: "PLAYING", currentSessionId: match.id });
});

test("the database refuses a match whose game differs from its room's", async () => {
  const r = await room("fake-game");
  const roomRow = await client.room.findUnique({ where: { number: r.number } });
  await expect(client.gameSession.create({ data: { roomCode: `BAD${randomUUID().slice(0, 6)}`.toUpperCase(), roomId: roomRow.id, gameKey: "quiz" } })).rejects.toThrow();
});

test("a room's game cannot change once it has a match", async () => {
  const r = await room("fake-game");
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Bia"))]));
  await expect(client.room.update({ where: { number: r.number }, data: { gameKey: "quiz" } })).rejects.toThrow();
  expect(match.gameKey).toBe("fake-game");
});

test("a Quiz service refuses a match of another game", async () => {
  const r = await room("fake-game");
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Caio"))]));
  await expect(database.sessions.getById(match.id)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  await expect(database.sessions.startMatch(match.id)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
});

// --- Core agnóstico: um segundo jogo usa salas sem tabelas do Quiz -------

test("a second game runs a match through the same platform without any Quiz table", async () => {
  fake.state.calls.length = 0;
  const r = await room("fake-game");
  const user = await account("Duda");
  const match = track(await database.rooms.startMatch(r.number, [entry(user)]));
  expect(match).toMatchObject({ gameKey: "fake-game" });
  for (const quizField of ["quizId", "quizSnapshot", "matchPhase"]) expect(match).not.toHaveProperty(quizField);
  expect(fake.state.calls).toEqual(["prepareMatch", "createMatchState", "createParticipantState"]);
  expect(await client.quizMatchState.count({ where: { matchId: match.id } })).toBe(0);
  const row = await client.gameSession.findUnique({ where: { id: match.id } });
  expect([row.quizId, row.quizSnapshot]).toEqual([null, null]);
  expect(await client.quizParticipantState.count({ where: { gameSessionId: match.id } })).toBe(0);
  expect(await client.matchParticipant.count({ where: { gameSessionId: match.id, userId: user } })).toBe(1);
});

test("an available game that declares a realtime implementation but has no runtime is refused at startup", () => {
  expect(() => createDatabase({ databaseUrl: isolatedTestUrl(), catalog: registry, extraRuntimes: [] })).toThrow(/fake-game/);
});

test("an unavailable game cannot start a new match even if its room already exists", async () => {
  const r = await room("fake-game");
  const cameSoon = createDatabase({ databaseUrl: isolatedTestUrl(), catalog: createGameRegistry([quizGame, synthetic("fake-game", "COMING_SOON")]), extraRuntimes: [fake.runtime] });
  try {
    await expect(cameSoon.rooms.startMatch(r.number, [entry(await account("Edu"))])).rejects.toMatchObject({ code: "GAME_UNAVAILABLE" });
  } finally {
    await cameSoon.close();
  }
});

test("a room of a game that left the registry fails clearly, and its history stays readable", async () => {
  const r = await room("fake-game");
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Fabi"))]));
  const gone = createDatabase({ databaseUrl: isolatedTestUrl(), catalog: createGameRegistry([quizGame]), extraRuntimes: [] });
  try {
    await expect(gone.rooms.startMatch(r.number, [entry(await account("Gabi"))])).rejects.toMatchObject({ code: "GAME_UNKNOWN" });
    expect((await gone.rooms.get(r.number)).gameKey).toBe("fake-game");
    expect((await client.gameSession.findUnique({ where: { id: match.id } })).gameKey).toBe("fake-game");
  } finally {
    await gone.close();
  }
});

test("a DISABLED game's history remains readable through the room DTO", async () => {
  const r = await room("fake-game");
  const disabled = createDatabase({ databaseUrl: isolatedTestUrl(), catalog: createGameRegistry([quizGame, synthetic("fake-game", "DISABLED")]), extraRuntimes: [fake.runtime] });
  try {
    expect(await disabled.rooms.get(r.number)).toMatchObject({ gameKey: "fake-game" });
    expect((await disabled.rooms.list({ gameKey: "fake-game" })).length).toBeGreaterThan(0);
  } finally {
    await disabled.close();
  }
});

// --- Participantes -------------------------------------------------------

test("participants are platform records tied to the authenticated account, sharing the Quiz state's id", async () => {
  const r = await quizRoom();
  const [ana, bia] = [await account("Ana"), await account("Bia")];
  const match = track(await database.rooms.startMatch(r.number, [entry(ana, "Ana"), entry(bia, "Bia")]));
  const generic = await client.matchParticipant.findMany({ where: { gameSessionId: match.id } });
  const quizState = await client.quizParticipantState.findMany({ where: { gameSessionId: match.id } });
  expect(generic.map((p) => p.userId).sort()).toEqual([ana, bia].sort());
  expect(quizState.map((p) => p.id).sort()).toEqual(generic.map((p) => p.id).sort());
  expect(generic.every((p) => p.leftAt === null)).toBe(true);
  expect(Object.keys(generic[0]).sort()).toEqual(["gameSessionId", "id", "joinedAt", "leftAt", "userId"]);
});

test("the same account cannot take part in the same match twice", async () => {
  const r = await quizRoom();
  const ana = await account("Ana");
  const match = track(await database.rooms.startMatch(r.number, [entry(ana), entry(ana, "Ana de novo")]));
  expect(await client.matchParticipant.count({ where: { gameSessionId: match.id, userId: ana } })).toBe(1);
  await expect(client.matchParticipant.create({ data: { gameSessionId: match.id, userId: ana } })).rejects.toThrow();
});

test("a solo match (one participant) uses the same room and match infrastructure", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Solo"))]));
  expect(match.participants).toHaveLength(1);
  const started = await database.sessions.startMatch(match.id);
  expect(started).toMatchObject({ status: "ACTIVE", matchPhase: "QUESTION", gameKey: "quiz" });
  expect(await client.room.findUnique({ where: { number: r.number } })).toMatchObject({ status: "PLAYING", currentSessionId: match.id });
});

test("a host can also be a participant (host is a reference, not a role)", async () => {
  const quiz = await publishedQuiz();
  const host = await account("Anfitria");
  const legacy = await database.organizers.createRoomFromPublished(quiz.id, `HOST${randomUUID().slice(0, 6).toUpperCase()}`, "t".repeat(40), { hostUserId: host, visibility: "PRIVATE" });
  track(legacy);
  expect(legacy.gameKey).toBe("quiz");
  const { participant } = await database.sessions.enterAsAccount({ gameSessionId: legacy.id, userId: host, displayName: "Anfitria" });
  const generic = await client.matchParticipant.findUnique({ where: { id: participant.id } });
  expect(generic).toMatchObject({ userId: host, gameSessionId: legacy.id });
  expect((await database.sessions.getById(legacy.id)).hostUserId).toBe(host);
  expect((await database.sessions.startMatch(legacy.id)).matchPhase).toBe("QUESTION");
  await client.gameSession.update({ where: { id: legacy.id }, data: { status: "FINISHED" } });
});

test("a dropped connection is not abandonment; an explicit leave is, and resuming cancels it", async () => {
  const r = await quizRoom();
  const user = await account("Gil");
  const match = track(await database.rooms.startMatch(r.number, [entry(user)]));
  const p = match.participants[0];
  await database.sessions.disconnectParticipant(match.id, p.id);
  expect((await client.matchParticipant.findUnique({ where: { id: p.id } })).leftAt).toBeNull();
  expect((await client.quizParticipantState.findUnique({ where: { id: p.id } })).disconnectedAt).not.toBeNull();
  await database.sessions.leaveParticipant(match.id, p.id);
  expect((await client.matchParticipant.findUnique({ where: { id: p.id } })).leftAt).not.toBeNull();
  await database.sessions.resumePresenceForAccount(match.id, user);
  expect((await client.matchParticipant.findUnique({ where: { id: p.id } })).leftAt).toBeNull();
});

// --- Concorrência e idempotência -----------------------------------------

test("two instances starting the same room at once create exactly one match", async () => {
  const r = await quizRoom();
  const [a, b] = [await account("Hugo"), await account("Ivo")];
  const results = await Promise.allSettled([database.rooms.startMatch(r.number, [entry(a)]), second.rooms.startMatch(r.number, [entry(b)])]);
  results.forEach((result) => result.status === "fulfilled" && track(result.value));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected").reason).toMatchObject({ code: "ROOM_NOT_WAITING" });
  const room = await client.room.findUnique({ where: { number: r.number } });
  expect(await client.gameSession.count({ where: { roomId: room.id, status: { in: ["WAITING", "ACTIVE"] } } })).toBe(1);
});

test("a double click (same request twice, concurrently) starts a single match", async () => {
  const r = await quizRoom();
  const user = await account("Jade");
  const results = await Promise.allSettled([database.rooms.startMatch(r.number, [entry(user)]), database.rooms.startMatch(r.number, [entry(user)])]);
  results.forEach((result) => result.status === "fulfilled" && track(result.value));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});

test("a retry after the match already started is refused, not duplicated", async () => {
  const r = await quizRoom();
  const user = await account("Kai");
  track(await database.rooms.startMatch(r.number, [entry(user)]));
  await expect(database.rooms.startMatch(r.number, [entry(user)])).rejects.toMatchObject({ code: "ROOM_NOT_WAITING" });
});

test("the database refuses a second live match in the same room even bypassing the service", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Lia"))]));
  const roomRow = await client.room.findUnique({ where: { number: r.number } });
  await expect(client.gameSession.create({ data: { roomCode: `DUP${randomUUID().slice(0, 6)}`.toUpperCase(), roomId: roomRow.id, gameKey: "quiz" } })).rejects.toThrow();
  await client.gameSession.update({ where: { id: match.id }, data: { status: "FINISHED" } });
  const next = await client.gameSession.create({ data: { roomCode: `NXT${randomUUID().slice(0, 6)}`.toUpperCase(), roomId: roomRow.id, gameKey: "quiz" } });
  sessionIds.add(next.id);
  expect(next.id).not.toBe(match.id);
});

test("a duplicate match code is refused by the unique constraint", async () => {
  const r = await room("fake-game");
  const roomRow = await client.room.findUnique({ where: { number: r.number } });
  const code = `COD${randomUUID().slice(0, 6)}`.toUpperCase();
  const first = await client.gameSession.create({ data: { roomCode: code, roomId: roomRow.id, gameKey: "fake-game", status: "FINISHED" } });
  sessionIds.add(first.id);
  await expect(client.gameSession.create({ data: { roomCode: code, gameKey: "fake-game" } })).rejects.toThrow();
});

test("releasing a room is idempotent and only the current match can release it", async () => {
  const r = await quizRoom();
  const roomRow = await client.room.findUnique({ where: { number: r.number } });
  const first = track(await database.rooms.startMatch(r.number, [entry(await account("Mel"))]));
  expect(await database.platform.rooms.release(roomRow.id, randomUUID())).toBe(false);
  expect((await database.rooms.get(r.number)).status).toBe("PLAYING");
  expect(await database.platform.rooms.release(roomRow.id, first.id)).toBe(true);
  expect(await database.platform.rooms.release(roomRow.id, first.id)).toBe(false);
  expect(await database.rooms.get(r.number)).toMatchObject({ status: "OPEN", currentSessionId: null });
  await client.gameSession.update({ where: { id: first.id }, data: { status: "FINISHED" } });
  await database.rooms.selectTheme(r.number, (await publishedQuiz()).id);
  const second1 = track(await database.rooms.startMatch(r.number, [entry(await account("Noa"))]));
  // A late release from the finished first match must not free the room now hosting the second.
  expect(await database.platform.rooms.release(roomRow.id, first.id)).toBe(false);
  expect((await database.rooms.get(r.number)).currentSessionId).toBe(second1.id);
});

test("finishing the same match twice is idempotent", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Ola"))]));
  await database.sessions.startMatch(match.id);
  const once = await database.sessions.finish(match.id);
  const twice = await database.sessions.finish(match.id);
  expect(once.status).toBe("FINISHED");
  expect(twice.status).toBe("FINISHED");
  expect(twice.finishedAt).toEqual(once.finishedAt);
});

// --- Recuperação ---------------------------------------------------------

test("live matches come from PostgreSQL alone; the game rebuilds what its own state says", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Pri"))]));
  expect((await second.platform.matches.live()).some((item) => item.match.id === match.id)).toBe(false); // lobby: not ACTIVE yet
  await database.sessions.startMatch(match.id);
  const fresh = createDatabase({ databaseUrl: isolatedTestUrl(), catalog: registry, extraRuntimes: [fake.runtime] }); // "restarted instance", no shared memory
  try {
    const live = (await fresh.platform.matches.live()).find((item) => item.match.id === match.id);
    expect(live.room).toMatchObject({ number: r.number, gameKey: "quiz" });
    expect(live.match).not.toHaveProperty("quizSnapshot");
    const { session } = await fresh.sessions.currentQuestion(match.id); // the Quiz's own state
    expect(session.matchPhase).toBe("QUESTION");
    expect(session.questionEndsAt).toBeInstanceOf(Date);
  } finally {
    await fresh.close();
  }
});

test("a live match of any game is listed; resolving its runtime is the host's job", async () => {
  const r = await room("fake-game");
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Quin"))]));
  await client.gameSession.update({ where: { id: match.id }, data: { status: "ACTIVE" } });
  expect((await database.platform.matches.live()).some((item) => item.match.id === match.id && item.match.gameKey === "fake-game")).toBe(true);
});

// --- Histórico, ranking e respostas seguem no módulo do Quiz -------------

test("Quiz answers and ranking still work and stay in the Quiz state", async () => {
  const r = await quizRoom();
  const [a, b] = [await account("Rui"), await account("Sol")];
  const match = track(await database.rooms.startMatch(r.number, [entry(a, "Rui"), entry(b, "Sol")]));
  const started = await database.sessions.startMatch(match.id);
  const question = started.quizSnapshot.questions[0];
  const correct = question.options.find((option) => option.isCorrect).id;
  const [ana] = match.participants;
  await database.sessions.answer({ gameSessionId: match.id, participantId: ana.id, questionRef: question.id, selectedOptionRef: correct });
  const result = await database.sessions.questionResult(match.id);
  expect(result.ranking[0]).toMatchObject({ id: ana.id });
  expect(result.ranking[0].score).toBeGreaterThan(0);
  expect(await client.answer.count({ where: { gameSessionId: match.id } })).toBe(1);
});
