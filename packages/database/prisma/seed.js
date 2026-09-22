import { pathToFileURL } from "node:url";
import { createClient } from "../src/client.js";
import { loadEnvironment } from "../tooling/environment.js";
import { transaction } from "../src/repositories/transaction.js";
import { quizRepository } from "../src/repositories/quizzes.js";
import { snapshotFromQuiz } from "../src/mappers/snapshot.js";
import { questionInputSchema } from "@quizarena/contracts";
import { DomainError, parse } from "../src/errors/domain-error.js";
import { hashSecret } from "../src/services/tokens.js";

export const SEED_QUIZ_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_ORGANIZER_ID = "00000000-0000-4000-8000-000000000002";
const content = [
  [
    "Qual planeta é conhecido como Planeta Vermelho?",
    ["Marte", "Vênus", "Júpiter", "Mercúrio"],
    "A aparência avermelhada de Marte vem de óxidos de ferro.",
  ],
  ["Quanto é 7 multiplicado por 8?", ["56", "54", "64", "48"], "7 × 8 = 56."],
  [
    "Qual é a capital do Brasil?",
    ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"],
    "Brasília é a capital federal desde 1960.",
  ],
  [
    "Quantos lados tem um triângulo?",
    ["3", "4", "5", "6"],
    "Um triângulo é um polígono de três lados.",
  ],
  [
    "Qual é a fórmula química da água?",
    ["H2O", "CO2", "O2", "NaCl"],
    "A água é formada por hidrogênio e oxigênio.",
  ],
  [
    "Qual destes animais é um mamífero?",
    ["Golfinho", "Tubarão", "Sardinha", "Polvo"],
    "Golfinhos são mamíferos aquáticos.",
  ],
];

export async function seedDevelopment(client) {
  return transaction(client, async (tx) => {
    await tx.organizer.upsert({ where: { id: SEED_ORGANIZER_ID }, update: {}, create: { id: SEED_ORGANIZER_ID, name: "Organizador de desenvolvimento", email: "organizador@quizarena.local", passwordHash: await hashSecret("QuizArena2026") } });
    const repo = quizRepository(tx);
    const existing = await repo.get(SEED_QUIZ_ID);
    if (existing) {
      if (
        existing.title !== "Conhecimentos Gerais" ||
        existing.status !== "PUBLISHED"
      )
        throw new DomainError("SEED_CONFLICT");
      snapshotFromQuiz(existing);
      if (existing.ownerId !== SEED_ORGANIZER_ID) await tx.quiz.update({ where: { id: SEED_QUIZ_ID }, data: { ownerId: SEED_ORGANIZER_ID } });
      return repo.get(SEED_QUIZ_ID);
    }
    await repo.create({
      id: SEED_QUIZ_ID,
      title: "Conhecimentos Gerais",
      description: "Quiz de desenvolvimento.",
      ownerId: SEED_ORGANIZER_ID,
    });
    for (const [index, [prompt, texts, explanation]] of content.entries()) {
      await repo.addQuestion(
        SEED_QUIZ_ID,
        parse(questionInputSchema, {
          position: index + 1,
          prompt,
          durationSeconds: 30,
          basePoints: 1000,
          explanation,
          options: texts.map((text, optionIndex) => ({
            position: optionIndex + 1,
            text,
            isCorrect: optionIndex === 0,
          })),
        }),
      );
    }
    snapshotFromQuiz(await repo.get(SEED_QUIZ_ID));
    await repo.publish(SEED_QUIZ_ID);
    return repo.get(SEED_QUIZ_ID);
  });
}
export async function runSeed() {
  loadEnvironment();
  const client = createClient(process.env.DATABASE_URL);
  try {
    const quiz = await seedDevelopment(client);
    console.info(
      JSON.stringify({
        seed: quiz.title,
        questions: quiz.questions.length,
        options: quiz.questions.reduce(
          (total, question) => total + question.options.length,
          0,
        ),
        quizzesWithSeedId: await client.quiz.count({
          where: { id: SEED_QUIZ_ID },
        }),
      }),
    );
  } finally {
    await client.$disconnect();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSeed().catch(() => {
    console.error(
      "Falha no seed: confira conexão, migration e possível SEED_CONFLICT.",
    );
    process.exitCode = 1;
  });
}
