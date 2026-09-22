import { z } from "zod";
import {
  quizInputSchema,
  questionInputSchema,
  quizStatusSchema,
} from "@quizarena/contracts";
import { quizRepository } from "../repositories/quizzes.js";
import { transaction } from "../repositories/transaction.js";
import { DomainError, parse } from "../errors/domain-error.js";
import { snapshotFromQuiz } from "../mappers/snapshot.js";

export async function requireQuiz(repository, id) {
  const quiz = await repository.get(parse(z.uuid(), id));
  if (!quiz) throw new DomainError("QUIZ_NOT_FOUND");
  return quiz;
}
export function createQuizService(client) {
  return {
    createDraft(input) {
      const { ownerId, ...quiz } = input;
      if (!ownerId) throw new DomainError("OWNER_REQUIRED");
      return transaction(client, (tx) =>
        quizRepository(tx).create({ ...parse(quizInputSchema, quiz), ownerId }),
      );
    },
    getById(id) {
      return requireQuiz(quizRepository(client), id);
    },
    listByStatus(status) {
      return quizRepository(client).list(parse(quizStatusSchema, status));
    },
    addQuestion(id, input) {
      return transaction(
        client,
        async (tx) => {
          const repo = quizRepository(tx);
          const quiz = await requireQuiz(repo, id);
          if (quiz.status !== "DRAFT") throw new DomainError("QUIZ_NOT_DRAFT");
          return repo.addQuestion(id, parse(questionInputSchema, input));
        },
        "QUESTION_POSITION_CONFLICT",
      );
    },
    publish(id) {
      return transaction(client, async (tx) => {
        const repo = quizRepository(tx);
        const quiz = await requireQuiz(repo, id);
        if (quiz.status === "ARCHIVED") throw new DomainError("QUIZ_ARCHIVED");
        snapshotFromQuiz(quiz);
        return quiz.status === "PUBLISHED" ? quiz : repo.publish(id);
      });
    },
    archive(id) {
      return transaction(client, async (tx) => {
        const repo = quizRepository(tx);
        const quiz = await requireQuiz(repo, id);
        return quiz.status === "ARCHIVED" ? quiz : repo.archive(id);
      });
    },
    buildQuizSnapshot(id) {
      return transaction(client, async (tx) => {
        const quiz = await requireQuiz(quizRepository(tx), id);
        if (quiz.status !== "PUBLISHED")
          throw new DomainError("QUIZ_NOT_PUBLISHED");
        return snapshotFromQuiz(quiz);
      });
    },
  };
}
