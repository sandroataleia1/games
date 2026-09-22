import { test, expect } from "vitest";
import {
  questionInputSchema,
  quizInputSchema,
  quizSnapshotSchema,
} from "@quizarena/contracts";
import { snapshotFromQuiz } from "../src/mappers/snapshot.js";
import { hashToken } from "../src/services/tokens.js";
import { isolatedTestUrl } from "../tooling/environment.js";
import { questionInput, quizFixture } from "./fixtures.js";

test("normaliza título e rejeita título vazio", () => {
  expect(quizInputSchema.parse({ title: "  Quiz  " }).title).toBe("Quiz");
  expect(quizInputSchema.safeParse({ title: "  " }).success).toBe(false);
});
test("snapshot rejeita quiz sem perguntas", () => {
  expect(() => snapshotFromQuiz({ ...quizFixture(), questions: [] })).toThrow(
    expect.objectContaining({ code: "QUIZ_INVALID" }),
  );
});
test.each([1, 7])("rejeita %i alternativas", (count) => {
  const input = questionInput();
  input.options = Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    text: "Alternativa",
    isCorrect: i === 0,
  }));
  expect(questionInputSchema.safeParse(input).success).toBe(false);
});
test.each([0, 2])("rejeita %i alternativas corretas", (count) => {
  const input = questionInput();
  input.options.forEach((option, i) => {
    option.isCorrect = i < count;
  });
  expect(questionInputSchema.safeParse(input).success).toBe(false);
  const quiz = quizFixture();
  quiz.questions[0].options.forEach((option, i) => {
    option.isCorrect = i < count;
  });
  expect(() => snapshotFromQuiz(quiz)).toThrow(
    expect.objectContaining({ code: "QUIZ_INVALID" }),
  );
});
test("rejeita posições duplicadas de perguntas e alternativas", () => {
  const quiz = quizFixture();
  quiz.questions[1].position = quiz.questions[0].position;
  expect(() => snapshotFromQuiz(quiz)).toThrow();
  const question = questionInput();
  question.options[1].position = question.options[0].position;
  expect(questionInputSchema.safeParse(question).success).toBe(false);
});
test.each([0, -1, 1.5])("rejeita posição %s", (position) => {
  expect(questionInputSchema.safeParse(questionInput(position)).success).toBe(
    false,
  );
});
test.each([4, 121, 10.5])("rejeita duração %s", (durationSeconds) => {
  expect(
    questionInputSchema.safeParse(questionInput(1, { durationSeconds }))
      .success,
  ).toBe(false);
});
test.each([99, 10001, 100.5])("rejeita pontos-base %s", (basePoints) => {
  expect(
    questionInputSchema.safeParse(questionInput(1, { basePoints })).success,
  ).toBe(false);
});
test("constrói, ordena e serializa snapshot sem metadados Prisma", () => {
  const quiz = quizFixture();
  const snapshot = snapshotFromQuiz(quiz);
  expect(snapshot.questions.map((q) => q.position)).toEqual([1, 2]);
  expect(snapshot.questions[0].options.map((o) => o.position)).toEqual([
    1, 2, 3, 4,
  ]);
  expect(quiz.questions.map((q) => q.position)).toEqual([2, 1]);
  expect(snapshot).not.toHaveProperty("status");
  expect(
    quizSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))),
  ).toEqual(snapshot);
});
test.each([0, 2, "1", null])("rejeita schemaVersion %j", (version) => {
  expect(
    quizSnapshotSchema.safeParse({
      ...snapshotFromQuiz(quizFixture()),
      schemaVersion: version,
    }).success,
  ).toBe(false);
});
test("snapshot é independente e profundamente imutável", () => {
  const quiz = quizFixture();
  const snapshot = snapshotFromQuiz(quiz);
  const original = JSON.stringify(snapshot);
  quiz.title = "Alterado";
  quiz.questions[0].options[0].text = "Alterada";
  expect(JSON.stringify(snapshot)).toBe(original);
  expect(() => {
    snapshot.title = "Tentativa";
  }).toThrow(TypeError);
  expect(() => {
    snapshot.questions[0].options[0].text = "Tentativa";
  }).toThrow(TypeError);
  expect(Object.isFrozen(snapshot.questions)).toBe(true);
});
test("rejeita snapshot fora de ordem e IDs repetidos", () => {
  const snapshot = JSON.parse(JSON.stringify(snapshotFromQuiz(quizFixture())));
  snapshot.questions.reverse();
  expect(quizSnapshotSchema.safeParse(snapshot).success).toBe(false);
  snapshot.questions.reverse();
  snapshot.questions[1].id = snapshot.questions[0].id;
  expect(quizSnapshotSchema.safeParse(snapshot).success).toBe(false);
});
test("tokens recebem scrypt com salt independente; token curto é rejeitado", async () => {
  const token = "unit-test-token-with-enough-length-only";
  const [a, b] = await Promise.all([hashToken(token), hashToken(token)]);
  expect(a).toMatch(/^scrypt\$v1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  expect(a).not.toContain(token);
  expect(a).not.toBe(b);
  await expect(hashToken("short")).rejects.toMatchObject({
    code: "TOKEN_INVALID",
  });
});
test("proteção de testes recusa schema de desenvolvimento", () => {
  const saved = process.env.TEST_DATABASE_URL;
  const savedDevelopment = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://local:local@127.0.0.1/local?schema=public";
  process.env.TEST_DATABASE_URL =
    "postgresql://local:local@127.0.0.1/local?schema=public";
  try {
    expect(() => isolatedTestUrl()).toThrow("schema exclusivo");
  } finally {
    if (saved === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = saved;
    if (savedDevelopment === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDevelopment;
  }
});
