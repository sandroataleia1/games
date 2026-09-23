import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, afterAll, test, expect } from "vitest";
import { createServerDatabase as createDatabase } from "../src/index.js";
import { createClient } from "@quizarena/database";
import { auditQuizLegacy } from "@multygames/game-quiz/server";
import { verifySqlObjects, unexpectedDrift } from "../../database/tooling/sql-objects.js";
import { isolatedTestUrl } from "@quizarena/database/testing";

// Applies the project's REAL migration files, in order, to throw-away schemas.
// "Before" is everything up to the last pre-PLATFORM-07B migration.
const MIGRATIONS = new URL("../../database/prisma/migrations/", import.meta.url);
const all = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const FIRST_07B = "20260924000100_platform_rooms_matches_participants";
const before = all.filter((name) => name < FIRST_07B);
const after = all.filter((name) => name >= FIRST_07B);
const QUIZ_MODULE = "20260925000100_quiz_module_persistence";
const platform07b = all.filter((name) => name >= FIRST_07B && name < QUIZ_MODULE);

// Splits a migration file into statements, keeping $$...$$ bodies (trigger
// functions) whole. Comment-only lines are dropped.
function statements(sql) {
  const text = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  const result = [];
  let current = "";
  let inDollar = false;
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith("$$", index)) { inDollar = !inDollar; current += "$$"; index++; continue; }
    if (text[index] === ";" && !inDollar) { if (current.trim()) result.push(current.trim()); current = ""; continue; }
    current += text[index];
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
// Like `prisma migrate deploy`: each migration file is applied atomically.
async function apply(client, names) {
  for (const name of names) {
    const list = statements(readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), "utf8"));
    await client.$transaction(async (tx) => { for (const statement of list) await tx.$executeRawUnsafe(statement); });
  }
}

const created = [];
let admin;
async function freshSchema() {
  const schema = `quizarena_migration_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created.push(schema);
  const url = new URL(isolatedTestUrl());
  url.searchParams.set("schema", schema);
  return { url: url.toString(), client: createClient(url.toString()) };
}
beforeAll(() => { admin = createClient(isolatedTestUrl()); });
afterAll(async () => {
  for (const schema of created) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});

const TOKEN_HASH = `scrypt$v1$${"a".repeat(32)}$${"b".repeat(128)}`;
const ids = Object.fromEntries(["u1", "u2", "u3", "quiz", "q1", "o1", "o2", "s1", "s2", "s3", "s4", "p1", "p2", "p3", "p4", "p5", "p6", "a1"].map((key) => [key, randomUUID()]));
const snapshot = (quizId) => JSON.stringify({ schemaVersion: 1, quizId, title: "Migração", questions: [{ id: ids.q1, position: 1, prompt: "?", type: "SINGLE_CHOICE", durationSeconds: 30, basePoints: 1000, explanation: null, options: [{ id: ids.o1, position: 1, text: "a", isCorrect: true }, { id: ids.o2, position: 2, text: "b", isCorrect: false }] }] });
const T = { created: "2026-09-20T10:00:00.000Z", started: "2026-09-20T10:01:00.000Z", finished: "2026-09-20T10:09:00.000Z", joined: "2026-09-20T10:00:30.000Z" };

// A realistic pre-07B database: accounts, a published quiz, rooms from the pool,
// a finished multiplayer match, a finished solo match, an active match, and a
// legacy hosted match whose host also plays plus an anonymous participant.
async function seedOldSchema(client) {
  const exec = (sql) => client.$executeRawUnsafe(sql);
  for (const [id, name] of [[ids.u1, "Ana"], [ids.u2, "Bia"], [ids.u3, "Caio"]]) {
    await exec(`INSERT INTO "Organizer" ("id","name","email","passwordHash","createdAt","updatedAt") VALUES ('${id}','${name}','${name.toLowerCase()}-${id}@example.com','${TOKEN_HASH}','${T.created}','${T.created}')`);
  }
  await exec(`INSERT INTO "Quiz" ("id","title","status","createdAt","updatedAt","publishedAt","ownerId","version") VALUES ('${ids.quiz}','Migração','PUBLISHED','${T.created}','${T.created}','${T.created}','${ids.u1}',1)`);
  await exec(`INSERT INTO "Question" ("id","quizId","position","prompt","durationSeconds","basePoints","createdAt","updatedAt") VALUES ('${ids.q1}','${ids.quiz}',1,'?',30,1000,'${T.created}','${T.created}')`);
  await exec(`INSERT INTO "QuestionOption" ("id","questionId","position","text","isCorrect","createdAt","updatedAt") VALUES ('${ids.o1}','${ids.q1}',1,'a',true,'${T.created}','${T.created}'),('${ids.o2}','${ids.q1}',2,'b',false,'${T.created}','${T.created}')`);
  const session = (id, code, extra) => exec(`INSERT INTO "GameSession" ("id","roomCode","quizId","quizSnapshot","createdAt",${extra.columns}) VALUES ('${id}','${code}','${ids.quiz}','${snapshot(ids.quiz)}'::jsonb,'${T.created}',${extra.values})`);
  const room = (number) => client.$queryRawUnsafe(`SELECT "id" FROM "Room" WHERE "number" = ${number}`).then((rows) => rows[0].id);
  const [r1, r2, r3] = [await room(1), await room(2), await room(3)];
  await session(ids.s1, "MIGFIN1", { columns: `"roomId","status","matchPhase","startedAt","finishedAt"`, values: `'${r1}','FINISHED','FINISHED','${T.started}','${T.finished}'` });
  await session(ids.s2, "MIGSOLO", { columns: `"roomId","status","matchPhase","startedAt","finishedAt"`, values: `'${r2}','FINISHED','FINISHED','${T.started}','${T.finished}'` });
  await session(ids.s3, "MIGLIVE", { columns: `"roomId","status","matchPhase","currentQuestionIndex","questionStartedAt","questionEndsAt","startedAt"`, values: `'${r3}','ACTIVE','QUESTION',0,'${T.started}','2099-01-01T00:00:00.000Z','${T.started}'` });
  await session(ids.s4, "MIGHOST", { columns: `"hostUserId","hostTokenHash","visibility","status"`, values: `'${ids.u1}','${TOKEN_HASH}','PRIVATE','WAITING'` });
  await exec(`UPDATE "Room" SET "status"='PLAYING', "currentSessionId"='${ids.s3}', "quizId"='${ids.quiz}' WHERE "id"='${r3}'`);
  await exec(`UPDATE "Room" SET "quizId"='${ids.quiz}' WHERE "id"='${r2}'`);
  const participant = (id, sessionId, userId, name, score) => exec(`INSERT INTO "Participant" ("id","gameSessionId","userId","displayName","normalizedName","reconnectTokenHash","score","joinedAt","lastSeenAt") VALUES ('${id}','${sessionId}',${userId ? `'${userId}'` : "NULL"},'${name}','${name.toLowerCase()}','${TOKEN_HASH}',${score},'${T.joined}','${T.joined}')`);
  await participant(ids.p1, ids.s1, ids.u1, "Ana", 900);
  await participant(ids.p2, ids.s1, ids.u2, "Bia", 400);
  await participant(ids.p3, ids.s2, ids.u3, "Caio", 750);
  await participant(ids.p4, ids.s3, ids.u2, "Bia", 0);
  await participant(ids.p5, ids.s4, ids.u1, "Ana", 0); // host who also plays
  await participant(ids.p6, ids.s4, null, "Visitante", 0); // anonymous pre-account participant
  await exec(`INSERT INTO "Answer" ("id","gameSessionId","participantId","questionRef","selectedOptionRef","isCorrect","responseTimeMs","pointsAwarded","answeredAt") VALUES ('${ids.a1}','${ids.s1}','${ids.p1}','${ids.q1}','${ids.o1}',true,2000,900,'${T.joined}')`);
}
const one = async (client, sql) => (await client.$queryRawUnsafe(sql))[0];
const count = async (client, table) => Number((await one(client, `SELECT count(*) AS n FROM "${table}"`)).n);

test("populated database: every row, id, relation, timestamp and score survives; gameKey is 'quiz'", async () => {
  const { client, url } = await freshSchema();
  try {
    await apply(client, before);
    await seedOldSchema(client);
    const rowsBefore = { rooms: await count(client, "Room"), sessions: await count(client, "GameSession"), participants: await count(client, "Participant"), answers: await count(client, "Answer") };
    const rankingBefore = await client.$queryRawUnsafe(`SELECT "id","score" FROM "Participant" WHERE "gameSessionId"='${ids.s1}' ORDER BY "score" DESC`);

    await apply(client, after);

    expect(await count(client, "Room")).toBe(rowsBefore.rooms);
    expect(await count(client, "GameSession")).toBe(rowsBefore.sessions);
    expect(await count(client, "Participant")).toBe(rowsBefore.participants);
    expect(await count(client, "Answer")).toBe(rowsBefore.answers);
    expect(Number((await one(client, `SELECT count(*) AS n FROM "Room" WHERE "gameKey" = 'quiz'`)).n)).toBe(rowsBefore.rooms);
    expect(Number((await one(client, `SELECT count(*) AS n FROM "GameSession" WHERE "gameKey" = 'quiz'`)).n)).toBe(rowsBefore.sessions);

    // Codes, states and historical timestamps are untouched (no "now()" reconstruction).
    const finished = await one(client, `SELECT "roomCode","status","matchPhase","createdAt","startedAt","finishedAt","quizId" FROM "GameSession" WHERE "id"='${ids.s1}'`);
    expect(finished).toMatchObject({ roomCode: "MIGFIN1", status: "FINISHED", matchPhase: "FINISHED", quizId: ids.quiz });
    expect(finished.createdAt.toISOString()).toBe(T.created);
    expect(finished.finishedAt.toISOString()).toBe(T.finished);
    expect(await client.$queryRawUnsafe(`SELECT "id","score" FROM "Participant" WHERE "gameSessionId"='${ids.s1}' ORDER BY "score" DESC`)).toEqual(rankingBefore);
    expect((await one(client, `SELECT "responseTimeMs","pointsAwarded" FROM "Answer" WHERE "id"='${ids.a1}'`))).toMatchObject({ responseTimeMs: 2000, pointsAwarded: 900 });

    // One platform record per Participant: same id, same account, original join date, never "left".
    const mismatched = await client.$queryRawUnsafe(`SELECT p."id" FROM "Participant" p LEFT JOIN "MatchParticipant" m ON m."id" = p."id" AND m."gameSessionId" = p."gameSessionId" AND m."userId" IS NOT DISTINCT FROM p."userId" AND m."joinedAt" = p."joinedAt" AND m."leftAt" IS NULL WHERE m."id" IS NULL OR p."matchParticipantId" <> p."id"`);
    expect(mismatched).toEqual([]);
    expect(await count(client, "MatchParticipant")).toBe(rowsBefore.participants);
    expect((await one(client, `SELECT "userId" FROM "MatchParticipant" WHERE "id"='${ids.p6}'`)).userId).toBeNull(); // anonymous legacy stays anonymous

    // The host who also plays keeps both facts.
    expect((await one(client, `SELECT "hostUserId" FROM "GameSession" WHERE "id"='${ids.s4}'`)).hostUserId).toBe(ids.u1);
    expect((await one(client, `SELECT "userId" FROM "MatchParticipant" WHERE "id"='${ids.p5}'`)).userId).toBe(ids.u1);

    // PLATFORM-07C: the module tables were filled from the legacy columns, same ids and stored timestamps.
    expect(await count(client, "QuizMatchState")).toBe(rowsBefore.sessions);
    expect(await count(client, "QuizRoomConfiguration")).toBe(2); // rooms 2 and 3 had a theme
    const state = await one(client, `SELECT s."quizId", s."matchPhase", s."currentQuestionIndex", s."questionEndsAt", s."createdAt", s."updatedAt", s."quizSnapshot" = g."quizSnapshot" AS same_snapshot FROM "QuizMatchState" s JOIN "GameSession" g ON g."id" = s."matchId" WHERE s."matchId" = '${ids.s1}'`);
    expect(state).toMatchObject({ quizId: ids.quiz, matchPhase: "FINISHED", same_snapshot: true });
    expect(state.createdAt.toISOString()).toBe(T.created);
    expect(state.updatedAt.toISOString()).toBe(T.finished); // finishedAt, never now()
    const live = await one(client, `SELECT "matchPhase", "currentQuestionIndex" FROM "QuizMatchState" WHERE "matchId" = '${ids.s3}'`);
    expect(live).toMatchObject({ matchPhase: "QUESTION", currentQuestionIndex: 0 });
    expect((await one(client, `SELECT c."quizId" FROM "QuizRoomConfiguration" c JOIN "Room" r ON r."id" = c."roomId" WHERE r."number" = 3`)).quizId).toBe(ids.quiz);
    const audit = await auditQuizLegacy(client);
    expect(audit.ok).toBe(true);
    expect(audit.totals).toMatchObject({ configurations: 2, matchStates: rowsBefore.sessions });
    // The new backfill is idempotent too (a partial rerun duplicates nothing).
    for (const statement of statements(readFileSync(new URL(`${QUIZ_MODULE}/migration.sql`, MIGRATIONS), "utf8")).filter((item) => /^INSERT INTO "Quiz(RoomConfiguration|MatchState)"/.test(item))) await client.$executeRawUnsafe(statement);
    expect(await count(client, "QuizMatchState")).toBe(rowsBefore.sessions);
    expect(await count(client, "QuizRoomConfiguration")).toBe(2);
    // Every SQL-only object and guard constraint survived the migrations.
    expect(await verifySqlObjects(client)).toEqual([]);

    // Re-running the backfill (a service restarted mid-transition) duplicates nothing.
    await client.$executeRawUnsafe(`INSERT INTO "MatchParticipant" ("id","gameSessionId","userId","joinedAt") SELECT p."id", p."gameSessionId", p."userId", p."joinedAt" FROM "Participant" p WHERE NOT EXISTS (SELECT 1 FROM "MatchParticipant" m WHERE m."id" = p."id")`);
    expect(await count(client, "MatchParticipant")).toBe(rowsBefore.participants);

    // Constraints are live on the migrated data.
    const roomOf = async (sessionId) => (await one(client, `SELECT "roomId" FROM "GameSession" WHERE "id"='${sessionId}'`)).roomId;
    await expect(client.$executeRawUnsafe(`INSERT INTO "GameSession" ("id","roomCode","roomId","gameKey","status") VALUES ('${randomUUID()}','MIGDUP','${await roomOf(ids.s3)}','quiz','WAITING')`)).rejects.toThrow(/23505/);
    await expect(client.$executeRawUnsafe(`INSERT INTO "GameSession" ("id","roomCode","roomId","gameKey","status") VALUES ('${randomUUID()}','MIGBAD','${await roomOf(ids.s1)}','other-game','FINISHED')`)).rejects.toThrow(/23503/);
    await expect(client.$executeRawUnsafe(`UPDATE "Room" SET "gameKey"='other-game' WHERE "id"='${await roomOf(ids.s1)}'`)).rejects.toThrow(/23503/);
    await expect(client.$executeRawUnsafe(`INSERT INTO "MatchParticipant" ("id","gameSessionId","userId") VALUES ('${randomUUID()}','${ids.s1}','${ids.u1}')`)).rejects.toThrow(/23505/);

    // The active match is recoverable from PostgreSQL alone, through the real platform + Quiz code.
    const database = createDatabase({ databaseUrl: url });
    try {
      const live = (await database.platform.matches.live()).find((item) => item.match.id === ids.s3);
      expect(live).toMatchObject({ room: { number: 3, gameKey: "quiz", status: "PLAYING" } });
      const { session } = await database.sessions.currentQuestion(ids.s3);
      expect(session).toMatchObject({ matchPhase: "QUESTION", currentQuestionIndex: 0 });
      expect(session.quizSnapshot.questions).toHaveLength(1);
      expect(await database.rooms.list({ gameKey: "quiz" })).toHaveLength(rowsBefore.rooms);
      expect((await database.sessions.getById(ids.s1)).gameKey).toBe("quiz");
    } finally {
      await database.close();
    }
  } finally {
    await client.$disconnect();
  }
}, 60000);

test("empty database: all migrations apply, the seeded pool is tagged 'quiz' and the constraints exist", async () => {
  const { client } = await freshSchema();
  try {
    await apply(client, all);
    expect(await count(client, "Room")).toBe(24);
    expect(Number((await one(client, `SELECT count(*) AS n FROM "Room" WHERE "gameKey" = 'quiz'`)).n)).toBe(24);
    expect(await count(client, "GameSession")).toBe(0);
    expect(await count(client, "MatchParticipant")).toBe(0);
    const constraints = (await client.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conrelid = '"GameSession"'::regclass AND contype = 'f'`)).map((row) => row.conname);
    expect(constraints).toContain("GameSession_roomId_gameKey_fkey");
    const indexes = (await client.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)).map((row) => row.indexname);
    expect(indexes).toContain("GameSession_one_live_match_per_room");
    // a match with no Quiz state is now storable (any other game)
    const roomId = (await one(client, `SELECT "id" FROM "Room" WHERE "number" = 1`)).id;
    await client.$executeRawUnsafe(`INSERT INTO "GameSession" ("id","roomCode","roomId","gameKey") VALUES ('${randomUUID()}','EMPTY1','${roomId}','quiz')`);
  } finally {
    await client.$disconnect();
  }
}, 60000);

test("07C aborts atomically when data cannot be classified, and applies cleanly once it can", async () => {
  const { client } = await freshSchema();
  try {
    await apply(client, before);
    await seedOldSchema(client);
    await apply(client, platform07b);
    // A room of another game that still references a quiz: the migration must refuse to guess.
    await client.$executeRawUnsafe(`UPDATE "Room" SET "gameKey" = 'other-game', "quizId" = '${ids.quiz}' WHERE "number" = 5`);
    await expect(apply(client, [QUIZ_MODULE])).rejects.toThrow(/PLATFORM-07C/);
    // Atomic: nothing of 07C exists, nothing was modified.
    expect((await one(client, `SELECT to_regclass('"QuizMatchState"')::text AS t, to_regclass('"QuizRoomConfiguration"')::text AS c`))).toEqual({ t: null, c: null });
    expect(await count(client, "GameSession")).toBe(4);
    // A Quiz match without a snapshot is unclassifiable as well.
    await client.$executeRawUnsafe(`UPDATE "Room" SET "gameKey" = 'quiz', "quizId" = NULL WHERE "number" = 5`);
    const roomId = (await one(client, `SELECT "id" FROM "Room" WHERE "number" = 6`)).id;
    await client.$executeRawUnsafe(`INSERT INTO "GameSession" ("id","roomCode","roomId","gameKey","status") VALUES ('${randomUUID()}','NOSNAP1','${roomId}','quiz','FINISHED')`);
    await expect(apply(client, [QUIZ_MODULE])).rejects.toThrow(/PLATFORM-07C/);
    await client.$executeRawUnsafe(`DELETE FROM "GameSession" WHERE "roomCode" = 'NOSNAP1'`);
    await apply(client, [QUIZ_MODULE]);
    expect(await count(client, "QuizMatchState")).toBe(4);
  } finally {
    await client.$disconnect();
  }
}, 60000);

test("the SQL-only objects are verified against pg_catalog; a migration that drops one is detected", async () => {
  const { client } = await freshSchema();
  try {
    await apply(client, all);
    expect(await verifySqlObjects(client)).toEqual([]);
    await client.$executeRawUnsafe(`DROP TRIGGER "QuizMatchState_snapshot_immutable" ON "QuizMatchState"`);
    await client.$executeRawUnsafe(`DROP INDEX "GameSession_one_live_match_per_room"`);
    await client.$executeRawUnsafe(`ALTER TABLE "QuizRoomConfiguration" DROP CONSTRAINT "QuizRoomConfiguration_gameKey_check"`);
    await client.$executeRawUnsafe(`ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_roomId_gameKey_fkey"`);
    expect((await verifySqlObjects(client)).map((object) => object.name).sort()).toEqual(["GameSession_one_live_match_per_room", "GameSession_roomId_gameKey_fkey", "QuizMatchState_snapshot_immutable", "QuizRoomConfiguration_gameKey_check"]);
  } finally {
    await client.$disconnect();
  }
}, 60000);

test("only the known cosmetic Prisma difference is tolerated as drift", () => {
  const known = 'ALTER TABLE "quizarena_test"."Room" ALTER COLUMN "updatedAt" DROP DEFAULT;';
  expect(unexpectedDrift(["-- AlterTable", known, ""].join("\n"), "quizarena_test")).toEqual([]);
  expect(unexpectedDrift(["-- AlterTable", 'DROP INDEX "GameSession_one_live_match_per_room";'].join("\n"), "quizarena_test")).toEqual(['DROP INDEX "GameSession_one_live_match_per_room";']);
});
