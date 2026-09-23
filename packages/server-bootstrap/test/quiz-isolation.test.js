import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createGameRegistry } from "@multygames/game-registry";
import { quizGame } from "@multygames/game-quiz";
import { auditQuizLegacy } from "@multygames/game-quiz/server";
import { createClient } from "@quizarena/database";
import { isolatedTestUrl } from "@quizarena/database/testing";
import { createServerDatabase } from "../src/index.js";
import { createSyntheticRuntime, syntheticGameModule } from "../src/testing.js";
import { questionInput } from "./fixtures.js";

// The Quiz keeps its state in ITS tables (QuizRoomConfiguration, QuizMatchState);
// the legacy columns are a rollout mirror. Everything here runs on the isolated schema.
const fake = createSyntheticRuntime("fake-game");
const catalog = createGameRegistry([quizGame, syntheticGameModule("fake-game")]);
const url = isolatedTestUrl();
const silent = { warn() {}, error() {}, info() {} };
let client, database, ownerId;
const accountIds = [];
const quizIds = [];
const roomNumbers = [];
const matchIds = new Set();
let nextRoom = 700;

const build = (options = {}) => createServerDatabase({ databaseUrl: url, catalog, extraRuntimes: [fake.runtime], logger: silent, ...options });
beforeAll(async () => {
  client = createClient(url);
  database = build();
  ownerId = await account("Dono");
});
afterEach(async () => {
  const ids = [...matchIds];
  await client.answer.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.quizParticipantState.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.matchParticipant.deleteMany({ where: { gameSessionId: { in: ids } } });
  await client.room.updateMany({ where: { currentSessionId: { in: ids } }, data: { status: "OPEN", currentSessionId: null } });
  await client.quizMatchState.deleteMany({ where: { matchId: { in: ids } } });
  await client.gameSession.deleteMany({ where: { id: { in: ids } } });
  matchIds.clear();
  await client.quizRoomConfiguration.deleteMany({ where: { room: { number: { in: roomNumbers } } } });
  await client.room.updateMany({ where: { number: { in: roomNumbers } }, data: { quizId: null } });
});
afterAll(async () => {
  await client.room.deleteMany({ where: { number: { in: roomNumbers } } });
  await client.quiz.deleteMany({ where: { id: { in: quizIds } } });
  await client.organizerSession.deleteMany({ where: { ownerId: { in: accountIds } } });
  await client.organizer.deleteMany({ where: { id: { in: accountIds } } });
  await Promise.all([client.$disconnect(), database.close()]);
});

async function account(name) {
  const id = (await database.organizers.register({ name, email: `${name.toLowerCase()}-${randomUUID()}@example.com`, password: "SenhaSegura123" })).user.id;
  accountIds.push(id);
  return id;
}
async function publishedQuiz() {
  const quiz = await database.quizzes.createDraft({ title: "Isolamento", ownerId });
  quizIds.push(quiz.id);
  await database.quizzes.addQuestion(quiz.id, questionInput(1));
  await database.quizzes.publish(quiz.id);
  return quiz;
}
async function room(gameKey = "quiz") {
  const created = await database.platform.rooms.create({ number: nextRoom++, gameKey });
  roomNumbers.push(created.number);
  return created;
}
async function quizRoom(db = database) {
  const created = await room();
  await db.rooms.selectTheme(created.number, (await publishedQuiz()).id);
  return created;
}
const track = (match) => { matchIds.add(match.id); return match; };
const entry = (userId) => ({ userId, displayName: "Ana" });
const rowOf = (number) => client.room.findUnique({ where: { number } });
// What an OLD release (pre-07C) wrote: only the legacy columns.
async function legacyOnlyMatch(overrides = {}) {
  const quiz = await publishedQuiz();
  const snapshot = await database.quizzes.buildQuizSnapshot(quiz.id);
  const match = await client.gameSession.create({ data: { roomCode: `OLD${randomUUID().slice(0, 7)}`.toUpperCase(), gameKey: "quiz", quizId: quiz.id, quizSnapshot: snapshot, ...overrides } });
  matchIds.add(match.id);
  return { match, quiz, snapshot };
}

// --- Fonte de verdade e espelho ------------------------------------------

test("a Quiz match keeps its snapshot and progress in QuizMatchState and mirrors them on the legacy columns", async () => {
  const r = await quizRoom();
  const configuration = await client.quizRoomConfiguration.findUnique({ where: { roomId: (await rowOf(r.number)).id } });
  expect(configuration).toMatchObject({ gameKey: "quiz", quizId: (await rowOf(r.number)).quizId });
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Ana"))]));
  const state = await client.quizMatchState.findUnique({ where: { matchId: match.id } });
  const legacy = await client.gameSession.findUnique({ where: { id: match.id } });
  expect(state).toMatchObject({ matchPhase: "LOBBY", gameKey: "quiz", quizId: configuration.quizId });
  expect(legacy.quizSnapshot).toEqual(state.quizSnapshot);
  await database.sessions.startMatch(match.id);
  const running = await client.quizMatchState.findUnique({ where: { matchId: match.id } });
  const mirrored = await client.gameSession.findUnique({ where: { id: match.id } });
  expect(running).toMatchObject({ matchPhase: "QUESTION", currentQuestionIndex: 0 });
  expect([mirrored.matchPhase, mirrored.currentQuestionIndex, mirrored.questionEndsAt]).toEqual([running.matchPhase, running.currentQuestionIndex, running.questionEndsAt]);
  expect(database.quiz.compat.counters).toEqual({ fallbacks: 0, divergences: 0 });
});

test("the generic match DTO never carries Quiz state; the Quiz service does, without hashes", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Bia"))]));
  for (const forbidden of ["quizSnapshot", "quizId", "matchPhase", "hostTokenHash", "reconnectTokenHash", "questionEndsAt"]) expect(match).not.toHaveProperty(forbidden);
  expect(JSON.stringify(match)).not.toContain("isCorrect");
  const view = await database.sessions.getById(match.id);
  expect(view.quizSnapshot.questions).toHaveLength(1);
  expect(view).not.toHaveProperty("hostTokenHash");
  expect(view.participants.every((participant) => !("reconnectTokenHash" in participant))).toBe(true);
});

test("the module table wins: a change made only to the legacy columns is reported, never served", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Caio"))]));
  await database.sessions.startMatch(match.id);
  const before = database.quiz.compat.counters.divergences;
  await client.gameSession.update({ where: { id: match.id }, data: { matchPhase: "QUESTION_RESULT" } });
  const { session } = await database.sessions.currentQuestion(match.id);
  expect(session.matchPhase).toBe("QUESTION");
  expect(database.quiz.compat.counters.divergences).toBe(before + 1);
  const audit = await auditQuizLegacy(client);
  expect(audit.ok).toBe(false);
  expect(audit.findings.matchesWhoseLegacyStateDiffers.map((row) => row.id)).toContain(match.id);
});

// --- Fallback explícito, observável e idempotente -------------------------

test("a legacy-only match (written by an old instance) is materialized once, visibly and idempotently", async () => {
  const { match, quiz } = await legacyOnlyMatch();
  expect(await client.quizMatchState.count({ where: { matchId: match.id } })).toBe(0);
  const before = database.quiz.compat.counters.fallbacks;
  const [a, b] = await Promise.all([database.sessions.getById(match.id), build().sessions.getById(match.id)]); // concurrent readers, two "instances"
  expect(a.quizId).toBe(quiz.id);
  expect(b.quizSnapshot.questions).toHaveLength(1);
  expect(await client.quizMatchState.count({ where: { matchId: match.id } })).toBe(1);
  expect(database.quiz.compat.counters.fallbacks).toBe(before + 1);
  await database.sessions.getById(match.id);
  expect(database.quiz.compat.counters.fallbacks).toBe(before + 1); // already materialized
});

test("a room theme set only on the legacy column is materialized once and visible", async () => {
  const r = await room();
  const quiz = await publishedQuiz();
  await client.room.update({ where: { number: r.number }, data: { quizId: quiz.id } });
  const before = database.quiz.compat.counters.fallbacks;
  expect((await database.quiz.rooms.themeOf(r.number)).quizId).toBe(quiz.id);
  expect(await client.quizRoomConfiguration.count({ where: { room: { number: r.number } } })).toBe(1);
  expect(database.quiz.compat.counters.fallbacks).toBe(before + 1);
});

test("rollout: an old instance advances a match, the new one recovers it and reports the disagreement", async () => {
  const r = await quizRoom();
  const account1 = await account("Dani");
  const match = track(await database.rooms.startMatch(r.number, [entry(account1)]));
  await database.sessions.startMatch(match.id);
  // The OLD release only knows the legacy columns: it moves the question along.
  const newEnds = new Date(Date.now() + 60000);
  await client.gameSession.update({ where: { id: match.id }, data: { questionEndsAt: newEnds } });
  const restarted = build();
  try {
    const live = (await restarted.platform.matches.live()).find((item) => item.match.id === match.id);
    expect(live).toBeTruthy(); // recoverable from PostgreSQL alone
    const before = restarted.quiz.compat.counters.divergences;
    const { session } = await restarted.sessions.currentQuestion(match.id);
    expect(session.matchPhase).toBe("QUESTION");
    expect(restarted.quiz.compat.counters.divergences).toBe(before + 1);
    expect((await auditQuizLegacy(client)).findings.matchesWhoseLegacyStateDiffers.map((row) => row.id)).toContain(match.id);
  } finally {
    await restarted.close();
  }
});

test("with the compatibility layer off nothing is mirrored and a legacy-only match is an explicit error, not silent legacy data", async () => {
  const off = build({ legacyCompat: "off" });
  try {
    const r = await quizRoom(off);
    const match = track(await off.rooms.startMatch(r.number, [entry(await account("Edu"))]));
    const legacy = await client.gameSession.findUnique({ where: { id: match.id } });
    expect([legacy.quizId, legacy.quizSnapshot]).toEqual([null, null]);
    expect((await client.room.findUnique({ where: { number: r.number } })).quizId).toBeNull();
    expect((await off.sessions.getById(match.id)).quizSnapshot.questions).toHaveLength(1);
    const { match: orphan } = await legacyOnlyMatch();
    await expect(off.sessions.getById(orphan.id)).rejects.toMatchObject({ code: "QUIZ_STATE_MISSING" });
    const other = await room();
    await client.room.update({ where: { number: other.number }, data: { quizId: (await publishedQuiz()).id } });
    expect((await off.quiz.rooms.themeOf(other.number)).quizId).toBeNull();
    expect(off.quiz.compat.counters).toEqual({ fallbacks: 0, divergences: 0 });
  } finally {
    await off.close();
  }
});

// --- Constraints específicas ---------------------------------------------

test("a room of another game cannot have Quiz configuration, and a Quiz room cannot change game while it has one", async () => {
  const fakeRoom = await rowOf((await room("fake-game")).number);
  const quiz = await publishedQuiz();
  await expect(client.quizRoomConfiguration.create({ data: { roomId: fakeRoom.id, gameKey: "quiz", quizId: quiz.id } })).rejects.toThrow(/Foreign key|foreign key|23503/i);
  await expect(database.quiz.rooms.select(fakeRoom.number, quiz.id)).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
  const quizRow = await rowOf((await quizRoom()).number);
  await expect(client.room.update({ where: { id: quizRow.id }, data: { gameKey: "fake-game" } })).rejects.toThrow();
});

test("Quiz state needs a Quiz match: another game's match, a missing match and a wrong gameKey are all refused", async () => {
  const fakeRoom = await room("fake-game");
  const fakeMatch = track(await database.rooms.startMatch(fakeRoom.number, [entry(await account("Fabi"))]));
  const quiz = await publishedQuiz();
  const snapshot = await database.quizzes.buildQuizSnapshot(quiz.id);
  const state = { quizId: quiz.id, quizSnapshot: snapshot };
  await expect(client.quizMatchState.create({ data: { matchId: fakeMatch.id, gameKey: "quiz", ...state } })).rejects.toThrow();
  await expect(client.quizMatchState.create({ data: { matchId: randomUUID(), gameKey: "quiz", ...state } })).rejects.toThrow();
  await expect(client.$executeRawUnsafe(`INSERT INTO "QuizMatchState" ("matchId","gameKey","quizId","quizSnapshot") VALUES ('${fakeMatch.id}','fake-game','${quiz.id}','{}'::jsonb)`)).rejects.toThrow(/23514/);
});

test("one configuration per room, one state per match, and both need an existing quiz", async () => {
  const r = await quizRoom();
  const roomRow = await rowOf(r.number);
  await expect(client.quizRoomConfiguration.create({ data: { roomId: roomRow.id, gameKey: "quiz", quizId: (await publishedQuiz()).id } })).rejects.toThrow();
  await expect(client.quizRoomConfiguration.create({ data: { roomId: (await rowOf((await room()).number)).id, gameKey: "quiz", quizId: randomUUID() } })).rejects.toThrow();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Gabi"))]));
  const state = await client.quizMatchState.findUnique({ where: { matchId: match.id } });
  await expect(client.quizMatchState.create({ data: { matchId: match.id, gameKey: "quiz", quizId: state.quizId, quizSnapshot: state.quizSnapshot } })).rejects.toThrow();
  await expect(client.$executeRawUnsafe(`INSERT INTO "QuizMatchState" ("matchId","gameKey","quizId","quizSnapshot") VALUES ('${randomUUID()}','quiz','${randomUUID()}','${JSON.stringify(state.quizSnapshot)}'::jsonb)`)).rejects.toThrow();
});

test("the snapshot root check and the immutability trigger protect QuizMatchState", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Hugo"))]));
  const state = await client.quizMatchState.findUnique({ where: { matchId: match.id } });
  await expect(client.quizMatchState.update({ where: { matchId: match.id }, data: { quizSnapshot: { ...state.quizSnapshot, title: "Outro" } } })).rejects.toThrow(/23514|immutable/);
  await expect(client.quizMatchState.update({ where: { matchId: match.id }, data: { quizId: (await publishedQuiz()).id } })).rejects.toThrow();
  await client.quizMatchState.update({ where: { matchId: match.id }, data: { matchPhase: "QUESTION" } }); // progress stays writable
  await expect(client.$executeRawUnsafe(`UPDATE "QuizMatchState" SET "quizSnapshot" = '{"schemaVersion":1}'::jsonb WHERE "matchId" = '${match.id}'`)).rejects.toThrow();
});

test("history is protected: a quiz used by a match cannot be deleted, a room theme is only a selection", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Ivo"))]));
  const state = await client.quizMatchState.findUnique({ where: { matchId: match.id } });
  await expect(client.quiz.delete({ where: { id: state.quizId } })).rejects.toThrow();
  const theme = await publishedQuiz();
  const other = await room();
  await database.quiz.rooms.select(other.number, theme.id);
  await client.quiz.delete({ where: { id: theme.id } }); // cascades the configuration (a selection, not history)
  expect(await client.quizRoomConfiguration.count({ where: { room: { number: other.number } } })).toBe(0);
});

test("a clean run leaves the audit without findings for its own data", async () => {
  const r = await quizRoom();
  const match = track(await database.rooms.startMatch(r.number, [entry(await account("Jade"))]));
  await database.sessions.startMatch(match.id);
  const audit = await auditQuizLegacy(client);
  for (const rows of Object.values(audit.findings)) expect(rows.map((row) => row.id)).not.toContain(match.id);
  expect(audit.totals.matchStates).toBeGreaterThan(0);
});
