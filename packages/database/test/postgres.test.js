import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, test, expect } from "vitest";
import { createDatabase, createDatabaseHealthProbe } from "../src/index.js";
import { createClient } from "../src/client.js";
import { transaction } from "../src/repositories/transaction.js";
import { quizRepository } from "../src/repositories/quizzes.js";
import { isolatedTestUrl } from "../tooling/environment.js";
import { seedDevelopment, SEED_QUIZ_ID } from "../prisma/seed.js";
import { questionInput, TEST_TOKEN } from "./fixtures.js";

let client, database, development;
let devCounts;
const ownedQuizIds = [];
const counts = async (db) =>
  Promise.all([
    db.quiz.count(),
    db.gameSession.count(),
    db.participant.count(),
    db.answer.count(),
  ]);
beforeAll(async () => {
  const url = isolatedTestUrl();
  client = createClient(url);
  database = createDatabase({ databaseUrl: url });
  development = createClient(process.env.DATABASE_URL);
  expect(
    (await client.$queryRaw`SELECT current_schema() AS name`)[0].name,
  ).toBe("quizarena_test");
  devCounts = await counts(development);
});
afterAll(async () => {
  if (client && ownedQuizIds.length) {
    // Somente IDs criados por esta execução, sempre no schema validado de testes.
    await client.$transaction(async (tx) => {
      const sessions = await tx.gameSession.findMany({
        where: { quizId: { in: ownedQuizIds } },
        select: { id: true },
      });
      const ids = sessions.map((s) => s.id);
      await tx.answer.deleteMany({ where: { gameSessionId: { in: ids } } });
      await tx.participant.deleteMany({
        where: { gameSessionId: { in: ids } },
      });
      await tx.gameSession.deleteMany({ where: { id: { in: ids } } });
      await tx.quiz.deleteMany({ where: { id: { in: ownedQuizIds } } });
    });
  }
  try {
    if (devCounts) expect(await counts(development)).toEqual(devCounts);
  } finally {
    await Promise.all([
      client?.$disconnect(),
      database?.close(),
      development?.$disconnect(),
    ]);
  }
});
async function draft(title = "Quiz de integração") {
  const quiz = await database.quizzes.createDraft({ title });
  ownedQuizIds.push(quiz.id);
  return quiz;
}
async function published() {
  const quiz = await draft();
  await database.quizzes.addQuestion(quiz.id, questionInput(2));
  await database.quizzes.addQuestion(quiz.id, questionInput(1));
  await database.quizzes.publish(quiz.id);
  return quiz;
}
async function session(quiz) {
  quiz ??= await published();
  const snapshot = await database.quizzes.buildQuizSnapshot(quiz.id);
  return database.sessions.create({
    roomCode: randomUUID().replaceAll("-", "").slice(0, 12),
    snapshot,
    hostToken: TEST_TOKEN,
  });
}
const participant = (gameSessionId, displayName = "Ana") =>
  database.sessions.registerParticipant({
    gameSessionId,
    displayName,
    reconnectToken: TEST_TOKEN,
  });
async function activeSession() {
  const s = await session();
  const p = await participant(s.id);
  // Fixture de ACTIVE: este incremento ainda não expõe comando de início de partida.
  await client.gameSession.update({
    where: { id: s.id },
    data: { status: "ACTIVE", startedAt: new Date() },
  });
  return { s, p };
}
function decision(s, p) {
  const question = s.quizSnapshot.questions[0];
  return {
    gameSessionId: s.id,
    participantId: p.id,
    questionRef: question.id,
    selectedOptionRef: question.options.find((o) => o.isCorrect).id,
    isCorrect: true,
    responseTimeMs: 1250,
    pointsAwarded: 750,
  };
}
test("cria e consulta rascunho normalizado; lista por status", async () => {
  const quiz = await draft("  Meu quiz  ");
  expect(quiz).toMatchObject({
    title: "Meu quiz",
    status: "DRAFT",
    publishedAt: null,
  });
  expect((await database.quizzes.getById(quiz.id)).questions).toEqual([]);
  expect(
    (await database.quizzes.listByStatus("DRAFT")).some(
      (q) => q.id === quiz.id,
    ),
  ).toBe(true);
});
test("rejeita quiz inexistente, rascunho sem perguntas e snapshot não publicado", async () => {
  await expect(database.quizzes.getById(randomUUID())).rejects.toMatchObject({
    code: "QUIZ_NOT_FOUND",
  });
  const quiz = await draft();
  await expect(database.quizzes.publish(quiz.id)).rejects.toMatchObject({
    code: "QUIZ_INVALID",
  });
  await expect(
    database.quizzes.buildQuizSnapshot(quiz.id),
  ).rejects.toMatchObject({ code: "QUIZ_NOT_PUBLISHED" });
  expect(
    (await client.quiz.findUnique({ where: { id: quiz.id } })).status,
  ).toBe("DRAFT");
});
test("publica quiz válido; ordena snapshot; arquivado não republica", async () => {
  const quiz = await published();
  expect((await database.quizzes.getById(quiz.id)).publishedAt).toBeInstanceOf(
    Date,
  );
  expect(
    (await database.quizzes.buildQuizSnapshot(quiz.id)).questions.map(
      (q) => q.position,
    ),
  ).toEqual([1, 2]);
  await expect(
    database.quizzes.addQuestion(quiz.id, questionInput(3)),
  ).rejects.toMatchObject({ code: "QUIZ_NOT_DRAFT" });
  await database.quizzes.archive(quiz.id);
  await expect(database.quizzes.publish(quiz.id)).rejects.toMatchObject({
    code: "QUIZ_ARCHIVED",
  });
  expect((await database.quizzes.getById(quiz.id)).archivedAt).toBeInstanceOf(
    Date,
  );
});
test("valida exatamente uma correta na publicação dentro da transação", async () => {
  const quiz = await draft();
  const question = await database.quizzes.addQuestion(quiz.id, questionInput());
  await client.questionOption.updateMany({
    where: { questionId: question.id },
    data: { isCorrect: false },
  });
  await expect(database.quizzes.publish(quiz.id)).rejects.toMatchObject({
    code: "QUIZ_INVALID",
  });
  expect((await database.quizzes.getById(quiz.id)).publishedAt).toBeNull();
});
test("pergunta inválida não deixa registros; posição duplicada tem código estável", async () => {
  const quiz = await draft();
  const input = questionInput();
  input.options[1].isCorrect = true;
  await expect(
    database.quizzes.addQuestion(quiz.id, input),
  ).rejects.toMatchObject({ code: "QUIZ_INVALID" });
  expect((await database.quizzes.getById(quiz.id)).questions).toHaveLength(0);
  await database.quizzes.addQuestion(quiz.id, questionInput());
  await expect(
    database.quizzes.addQuestion(quiz.id, questionInput()),
  ).rejects.toMatchObject({ code: "QUESTION_POSITION_CONFLICT" });
});
test("persiste sessão, consulta por ID/código e armazena apenas hash", async () => {
  const s = await session();
  expect(s.status).toBe("WAITING");
  expect(s).not.toHaveProperty("hostTokenHash");
  expect((await database.sessions.getByCode(s.roomCode.toLowerCase())).id).toBe(
    s.id,
  );
  expect((await database.sessions.getById(s.id)).quizSnapshot).toEqual(
    s.quizSnapshot,
  );
  const row = await client.gameSession.findUnique({ where: { id: s.id } });
  expect(row.hostTokenHash).toMatch(/^scrypt\$v1\$/);
  expect(JSON.stringify(row)).not.toContain(TEST_TOKEN);
  await expect(
    database.sessions.create({
      roomCode: s.roomCode,
      snapshot: s.quizSnapshot,
      hostToken: TEST_TOKEN,
    }),
  ).rejects.toMatchObject({ code: "ROOM_CODE_CONFLICT" });
  await expect(
    database.sessions.create({
      roomCode: "TEST1234",
      snapshot: { ...s.quizSnapshot, schemaVersion: 2 },
      hostToken: TEST_TOKEN,
    }),
  ).rejects.toMatchObject({ code: "QUIZ_INVALID" });
});
test("nomes normalizados duplicados na mesma sessão conflitam; outra sessão permite", async () => {
  const s = await session();
  const results = await Promise.allSettled([
    participant(s.id, "  Ana   Silva "),
    participant(s.id, "ana silva"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected").reason.code).toBe(
    "PARTICIPANT_NAME_CONFLICT",
  );
  const p = results.find((r) => r.status === "fulfilled").value;
  expect(p.normalizedName).toBe("ana silva");
  expect(p.score).toBe(0);
  expect(p).not.toHaveProperty("reconnectTokenHash");
  const row = await client.participant.findUnique({ where: { id: p.id } });
  expect(row.reconnectTokenHash).toMatch(/^scrypt\$v1\$/);
  expect(row.reconnectTokenHash).not.toContain(TEST_TOKEN);
  const other = await session();
  expect((await participant(other.id, "ANA SILVA")).id).not.toBe(p.id);
});
test("snapshot histórico independe da edição e exclusão das perguntas originais", async () => {
  const { s, p } = await activeSession();
  const original = JSON.stringify(s.quizSnapshot);
  await client.quiz.update({
    where: { id: s.quizId },
    data: { title: "Título editado" },
  });
  await client.question.deleteMany({ where: { quizId: s.quizId } });
  const answer = await database.sessions.registerAnswer(decision(s, p));
  const loaded = await database.sessions.getById(s.id);
  expect(JSON.stringify(loaded.quizSnapshot)).toBe(original);
  expect(answer).toMatchObject(decision(s, p));
  expect(answer.answeredAt).toBeInstanceOf(Date);
  expect(await client.answer.findUnique({ where: { id: answer.id } })).toEqual(
    answer,
  );
});
test("trigger bloqueia snapshot e quizId, permite atualizações legítimas", async () => {
  const s = await session();
  const row = await client.gameSession.findUnique({ where: { id: s.id } });
  await expect(
    client.gameSession.update({
      where: { id: s.id },
      data: { quizSnapshot: { ...row.quizSnapshot, title: "Alterado" } },
    }),
  ).rejects.toThrow();
  const another = await published();
  await expect(
    client.gameSession.update({
      where: { id: s.id },
      data: { quizId: another.id },
    }),
  ).rejects.toThrow();
  await client.gameSession.update({
    where: { id: s.id },
    data: {
      status: "ACTIVE",
      startedAt: new Date(),
      quizSnapshot: row.quizSnapshot,
    },
  });
  const finished = await database.sessions.finish(s.id);
  expect(finished).toMatchObject({
    status: "FINISHED",
    quizSnapshot: s.quizSnapshot,
  });
  expect(finished.finishedAt).toBeInstanceOf(Date);
  expect((await database.sessions.finish(s.id)).finishedAt).toEqual(
    finished.finishedAt,
  );
});
test("uma resposta por participante e pergunta, inclusive sob concorrência", async () => {
  const { s, p } = await activeSession();
  const results = await Promise.allSettled([
    database.sessions.registerAnswer(decision(s, p)),
    database.sessions.registerAnswer(decision(s, p)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected").reason.code).toBe(
    "ANSWER_ALREADY_SUBMITTED",
  );
  expect(await client.answer.count({ where: { gameSessionId: s.id } })).toBe(1);
});
test("rejeita referência externa, decisão incoerente e participante de outra sessão", async () => {
  const { s, p } = await activeSession();
  await expect(
    database.sessions.registerAnswer({
      ...decision(s, p),
      questionRef: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_REFERENCE_INVALID" });
  await expect(
    database.sessions.registerAnswer({
      ...decision(s, p),
      selectedOptionRef: s.quizSnapshot.questions[1].options[0].id,
    }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_REFERENCE_INVALID" });
  await expect(
    database.sessions.registerAnswer({ ...decision(s, p), isCorrect: false }),
  ).rejects.toMatchObject({ code: "ANSWER_DECISION_INVALID" });
  const other = await session();
  const outsider = await participant(other.id);
  await expect(
    database.sessions.registerAnswer({
      ...decision(s, p),
      participantId: outsider.id,
    }),
  ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_FOUND" });
  await expect(
    client.answer.create({
      data: { ...decision(s, p), participantId: outsider.id },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  expect(await client.answer.count({ where: { gameSessionId: s.id } })).toBe(0);
});
test("banco rejeita valores negativos e preserva relações históricas", async () => {
  const { s, p } = await activeSession();
  await expect(
    client.participant.update({ where: { id: p.id }, data: { score: -1 } }),
  ).rejects.toThrow();
  await expect(
    client.answer.create({ data: { ...decision(s, p), responseTimeMs: -1 } }),
  ).rejects.toThrow();
  await expect(
    client.answer.create({ data: { ...decision(s, p), pointsAwarded: -1 } }),
  ).rejects.toThrow();
  await expect(
    client.quiz.delete({ where: { id: s.quizId } }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    client.gameSession.delete({ where: { id: s.id } }),
  ).rejects.toMatchObject({ code: "P2003" });
});
test("banco protege título, posições, duração, pontos e formato dos hashes", async () => {
  const quiz = await draft();
  await expect(
    client.quiz.update({ where: { id: quiz.id }, data: { title: " " } }),
  ).rejects.toThrow();
  const q = await database.quizzes.addQuestion(quiz.id, questionInput());
  for (const data of [
    { position: 0 },
    { durationSeconds: 4 },
    { durationSeconds: 121 },
    { basePoints: 99 },
    { basePoints: 10001 },
  ]) {
    await expect(
      client.question.update({ where: { id: q.id }, data }),
    ).rejects.toThrow();
  }
  await expect(
    client.questionOption.update({
      where: { id: q.options[0].id },
      data: { text: " " },
    }),
  ).rejects.toThrow();
  const s = await session();
  await expect(
    client.gameSession.update({
      where: { id: s.id },
      data: { hostTokenHash: TEST_TOKEN },
    }),
  ).rejects.toThrow();
});
test("falha SQL após escrita reverte a transação inteira", async () => {
  const id = randomUUID();
  await expect(
    transaction(
      client,
      async (tx) => {
        const repo = quizRepository(tx);
        await repo.create({ id, title: "Rollback" });
        const input = questionInput();
        input.options[1].position = input.options[0].position;
        await repo.addQuestion(id, input);
      },
      "ROLLBACK_CONFLICT",
    ),
  ).rejects.toMatchObject({ code: "ROLLBACK_CONFLICT" });
  expect(await client.quiz.findUnique({ where: { id } })).toBeNull();
  expect(await client.question.count({ where: { quizId: id } })).toBe(0);
});
test("seed executado duas vezes é idempotente e não cria partidas", async () => {
  const before = await Promise.all([
    client.gameSession.count(),
    client.participant.count(),
    client.answer.count(),
  ]);
  const first = await seedDevelopment(client);
  const second = await seedDevelopment(client);
  expect(first).toEqual(second);
  expect(await client.quiz.count({ where: { id: SEED_QUIZ_ID } })).toBe(1);
  expect(second.questions).toHaveLength(6);
  expect(
    second.questions.every(
      (q) =>
        q.options.length === 4 &&
        q.options.filter((o) => o.isCorrect).length === 1,
    ),
  ).toBe(true);
  expect(
    await Promise.all([
      client.gameSession.count(),
      client.participant.count(),
      client.answer.count(),
    ]),
  ).toEqual(before);
});
test("probe público consulta PostgreSQL e encerra o pool", async () => {
  const probe = createDatabaseHealthProbe(isolatedTestUrl());
  try {
    expect(await probe.check()).toBe(true);
  } finally {
    await probe.close();
  }
});
