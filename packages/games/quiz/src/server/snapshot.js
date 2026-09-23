import { quizSnapshotSchema } from "@quizarena/contracts";
import { parse } from "@quizarena/database";

export function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
export function validateSnapshot(value) {
  return deepFreeze(parse(quizSnapshotSchema, value, "QUIZ_INVALID"));
}
export function snapshotFromQuiz(quiz) {
  return validateSnapshot({
    schemaVersion: 1,
    quizId: quiz.id,
    title: quiz.title,
    questions: [...quiz.questions]
      .sort((a, b) => a.position - b.position)
      .map((question) => ({
        id: question.id,
        position: question.position,
        prompt: question.prompt,
        type: question.type,
        durationSeconds: question.durationSeconds,
        basePoints: question.basePoints,
        explanation: question.explanation ?? null,
        options: [...question.options]
          .sort((a, b) => a.position - b.position)
          .map((option) => ({
            id: option.id,
            position: option.position,
            text: option.text,
            isCorrect: option.isCorrect,
          })),
      })),
  });
}
export function participantDTO(participant) {
  const result = structuredClone(participant);
  delete result.reconnectTokenHash;
  return result;
}
