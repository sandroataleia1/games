import { randomUUID } from "node:crypto";

export function questionInput(position = 1, overrides = {}) {
  return {
    position,
    prompt: "Quanto é 2 + 2?",
    type: "SINGLE_CHOICE",
    durationSeconds: 30,
    basePoints: 1000,
    explanation: "2 + 2 = 4.",
    options: [4, 3, 5, 6].map((answer, i) => ({
      position: i + 1,
      text: String(answer),
      isCorrect: i === 0,
    })),
    ...overrides,
  };
}
export function quizFixture() {
  return {
    id: randomUUID(),
    title: "Conhecimentos",
    status: "PUBLISHED",
    questions: [2, 1].map((position) => ({
      ...questionInput(position),
      id: randomUUID(),
      options: questionInput()
        .options.map((option) => ({ ...option, id: randomUUID() }))
        .reverse(),
    })),
  };
}
export const TEST_TOKEN = "development-test-token-not-a-real-secret-123456";
