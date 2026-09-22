import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabase } from "../src/index.js";
import { createClient } from "../src/client.js";
import { isolatedTestUrl } from "../tooling/environment.js";
import { verifySecret } from "../src/services/tokens.js";

const url = isolatedTestUrl();
const database = createDatabase({ databaseUrl: url });
const client = createClient(url);
const ownerIds = [];
async function owner(label) { const result = await database.organizers.register({ name: `Pessoa ${label}`, email: `  ${label}-${randomUUID()}@EXAMPLE.COM `, password: "SenhaSegura123" }); ownerIds.push(result.user.id); return result; }
const question = { prompt: "Qual é a resposta?", durationSeconds: 30, basePoints: 1000, explanation: null, options: [{ text: "Certa", isCorrect: true }, { text: "Errada", isCorrect: false }] };

beforeAll(async () => expect((await client.$queryRaw`SELECT current_schema() AS name`)[0].name).toBe("quizarena_test"));
afterAll(async () => { await client.answer.deleteMany({ where: { gameSession: { quiz: { ownerId: { in: ownerIds } } } } }); await client.participant.deleteMany({ where: { gameSession: { quiz: { ownerId: { in: ownerIds } } } } }); await client.gameSession.deleteMany({ where: { quiz: { ownerId: { in: ownerIds } } } }); await client.quiz.deleteMany({ where: { ownerId: { in: ownerIds } } }); await client.organizerSession.deleteMany({ where: { ownerId: { in: ownerIds } } }); await client.organizer.deleteMany({ where: { id: { in: ownerIds } } }); await Promise.all([database.close(), client.$disconnect()]); });

test("normalizes email, hashes password, rotates login session and invalidates logout/expiry", async () => {
  const registered = await owner("auth");
  expect(registered.user.email).toMatch(/@example\.com$/);
  expect(registered.user).not.toHaveProperty("passwordHash");
  const row = await client.organizer.findUnique({ where: { id: registered.user.id } });
  expect(row.passwordHash).toMatch(/^scrypt\$v1\$/);
  await expect(database.organizers.register({ name: "Outra Pessoa", email: registered.user.email.toUpperCase(), password: "SenhaSegura123" })).rejects.toMatchObject({ code: "EMAIL_CONFLICT" });
  await expect(database.organizers.login({ email: registered.user.email, password: "SenhaErrada123" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const logged = await database.organizers.login({ email: registered.user.email, password: "SenhaSegura123" });
  expect(await database.organizers.authenticate(registered.token)).toBeNull();
  expect((await database.organizers.authenticate(logged.token)).id).toBe(registered.user.id);
  await database.organizers.logout(logged.token);
  expect(await database.organizers.authenticate(logged.token)).toBeNull();
  const expired = await database.organizers.login({ email: registered.user.email, password: "SenhaSegura123" });
  await client.organizerSession.updateMany({ where: { ownerId: registered.user.id }, data: { expiresAt: new Date(0) } });
  expect(await database.organizers.authenticate(expired.token)).toBeNull();
});

test("enforces ownership, publication validation, optimistic concurrency and historical retention", async () => {
  const a = await owner("owner-a"), b = await owner("owner-b");
  let quiz = await database.organizers.createQuiz(a.user.id, { title: "Quiz privado", description: "Rascunho" });
  for (const operation of [() => database.organizers.getQuiz(b.user.id, quiz.id), () => database.organizers.updateQuiz(b.user.id, quiz.id, { title: "Ataque", description: null }), () => database.organizers.publish(b.user.id, quiz.id), () => database.organizers.remove(b.user.id, quiz.id)]) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(database.organizers.publish(a.user.id, quiz.id)).rejects.toMatchObject({ code: "QUIZ_INVALID", details: expect.any(Array) });
  quiz = await database.organizers.addQuestion(a.user.id, quiz.id, question);
  await expect(database.organizers.createOwnedRoom(b.user.id, quiz.id, "ABC234", "development-test-token-not-a-real-secret-123456")).rejects.toMatchObject({ code: "NOT_FOUND" });
  const concurrent = await Promise.allSettled([database.organizers.updateQuiz(a.user.id, quiz.id, { title: "Versão A", description: null, version: quiz.version }), database.organizers.updateQuiz(a.user.id, quiz.id, { title: "Versão B", description: null, version: quiz.version })]);
  expect(concurrent.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find((item) => item.status === "rejected").reason.code).toBe("CONFLICT");
  const published = await database.organizers.publish(a.user.id, quiz.id);
  expect(published.status).toBe("PUBLISHED");
  expect((await database.organizers.publishedOwned(b.user.id))).toEqual([]);
  const snapshot = await database.organizers.buildOwnedSnapshot(a.user.id, quiz.id);
  const session = await database.sessions.create({ roomCode: randomUUID().replaceAll("-", "").slice(0, 12), snapshot, hostToken: "development-test-token-not-a-real-secret-123456" });
  expect((await database.organizers.unpublish(a.user.id, quiz.id)).status).toBe("DRAFT");
  await expect(database.organizers.remove(a.user.id, quiz.id)).rejects.toMatchObject({ code: "QUIZ_IN_USE" });
  expect((await database.sessions.getById(session.id)).quizSnapshot.title).toBe(snapshot.title);
});

test("reorders alternatives without changing identity, correctness, persistence or snapshot", async () => {
  const account = await owner("option-order");
  let quiz = await database.organizers.createQuiz(account.user.id, { title: "Ordem estável", description: null });
  quiz = await database.organizers.addQuestion(account.user.id, quiz.id, { ...question, options: [{ text: "A", isCorrect: false }, { text: "B", isCorrect: false }, { text: "C", isCorrect: true }, { text: "D", isCorrect: false }] });
  const original = quiz.questions[0], reordered = [original.options[2], original.options[0], original.options[1], original.options[3]];
  quiz = await database.organizers.updateQuestion(account.user.id, quiz.id, original.id, { prompt: original.prompt, durationSeconds: original.durationSeconds, basePoints: original.basePoints, explanation: original.explanation, version: quiz.version, options: reordered.map(({ id, text, isCorrect }) => ({ id, text, isCorrect })) });
  expect(quiz.questions[0].options.map(({ id }) => id)).toEqual(reordered.map(({ id }) => id));
  expect(quiz.questions[0].options.find(({ isCorrect }) => isCorrect)).toMatchObject({ id: original.options[2].id, text: "C", position: 1 });
  const persisted = await database.organizers.getQuiz(account.user.id, quiz.id);
  expect(persisted.questions[0].options.map(({ text }) => text)).toEqual(["C", "A", "B", "D"]);
  const stale = { prompt: original.prompt, durationSeconds: 40, basePoints: original.basePoints, explanation: null, version: quiz.version, options: reordered.map(({ id, text, isCorrect }) => ({ id, text, isCorrect })) };
  const concurrent = await Promise.allSettled([database.organizers.updateQuestion(account.user.id, quiz.id, original.id, stale), database.organizers.updateQuestion(account.user.id, quiz.id, original.id, { ...stale, durationSeconds: 50 })]);
  expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find(({ status }) => status === "rejected").reason.code).toBe("CONFLICT");
  const published = await database.organizers.publish(account.user.id, quiz.id);
  const snapshot = await database.organizers.buildOwnedSnapshot(account.user.id, quiz.id);
  expect(published.questions[0].options[0]).toMatchObject({ id: original.options[2].id, isCorrect: true });
  expect(snapshot.questions[0].options[0]).toMatchObject({ id: original.options[2].id, text: "C" });
});

test("legacy migration owner has no valid password or session and is not public", async () => {
  const legacy = await client.organizer.findFirst({ where: { email: { endsWith: "@migration.invalid" } } });
  if (!legacy) return;
  expect(await verifySecret("SenhaSegura123", legacy.passwordHash)).toBe(false);
  expect(await client.organizerSession.count({ where: { ownerId: legacy.id } })).toBe(0);
  await expect(database.organizers.login({ email: legacy.email, password: "SenhaSegura123" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  expect(await client.organizerSession.count({ where: { ownerId: legacy.id } })).toBe(0);
  expect(await database.organizers.authenticate(null)).toBeNull();
  expect((await database.organizers.publishedOwned(legacy.id)).every((quiz) => quiz.status === "PUBLISHED")).toBe(true);
});
