import { z } from "zod";

export const QUIZ_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
});
export const SESSION_STATUS = Object.freeze({
  WAITING: "WAITING",
  ACTIVE: "ACTIVE",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
});
export const QUESTION_TYPE = Object.freeze({ SINGLE_CHOICE: "SINGLE_CHOICE" });
export const quizStatusSchema = z.enum(Object.values(QUIZ_STATUS));
const positivePosition = z.number().int().min(1).max(2147483647);
const text = z.string().trim().min(1);
const explanation = z
  .string()
  .trim()
  .max(10000)
  .nullable()
  .optional()
  .default(null);

export const optionInputSchema = z
  .object({
    position: positivePosition,
    text: text.max(1000),
    isCorrect: z.boolean(),
  })
  .strict();

function validateOptions(question, context) {
  if (question.options.filter((option) => option.isCorrect).length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Exatamente uma alternativa correta é obrigatória.",
    });
  }
  if (
    new Set(question.options.map((option) => option.position)).size !==
    question.options.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Posições de alternativas duplicadas.",
    });
  }
}
const questionShape = {
  position: positivePosition,
  prompt: text.max(5000),
  type: z
    .literal(QUESTION_TYPE.SINGLE_CHOICE)
    .default(QUESTION_TYPE.SINGLE_CHOICE),
  durationSeconds: z.number().int().min(5).max(120),
  basePoints: z.number().int().min(100).max(10000),
  explanation,
};
export const questionInputSchema = z
  .object({
    ...questionShape,
    options: z.array(optionInputSchema).min(2).max(6),
  })
  .strict()
  .superRefine(validateOptions);
export const quizInputSchema = z
  .object({
    title: text.max(300),
    description: z
      .string()
      .trim()
      .max(10000)
      .nullable()
      .optional()
      .default(null),
  })
  .strict();
const snapshotQuestionSchema = z
  .object({
    id: z.uuid(),
    ...questionShape,
    options: z
      .array(optionInputSchema.extend({ id: z.uuid() }))
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine(validateOptions);

export const quizSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    quizId: z.uuid(),
    title: text.max(300),
    questions: z.array(snapshotQuestionSchema).min(1),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ordered = (items) =>
      items.every(
        (item, index) =>
          index === 0 || items[index - 1].position < item.position,
      );
    if (
      !ordered(snapshot.questions) ||
      snapshot.questions.some((question) => !ordered(question.options))
    ) {
      context.addIssue({
        code: "custom",
        message: "Posições devem ser únicas e ordenadas.",
      });
    }
    const ids = snapshot.questions.flatMap((question) => [
      question.id,
      ...question.options.map((option) => option.id),
    ]);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Identificadores duplicados no snapshot.",
      });
  });
