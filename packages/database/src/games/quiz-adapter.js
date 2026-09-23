import { randomBytes } from "node:crypto";
import { defineGameServerAdapter } from "@quizarena/game-registry";
import { DomainError } from "../errors/domain-error.js";
import { snapshotFromQuiz } from "../mappers/snapshot.js";
import { createQuizParticipantState } from "../repositories/sessions.js";
import { hashToken } from "../services/tokens.js";
import { QUIZ_GAME_KEY } from "./quiz-key.js";

// Server adapter of the Quiz: everything the platform needs from it to run a
// match, and nothing more. It lives beside the Quiz services (it reuses their
// snapshot/participant code) and is registered explicitly by createDatabase -
// the platform core never imports this file. Extracting it next to the Quiz
// module is the natural follow-up once the Quiz match service moves out of
// this package (ADR-008).
export const quizServerAdapter = defineGameServerAdapter({
  gameKey: QUIZ_GAME_KEY,

  // The room's theme must be a published quiz with questions; its snapshot is
  // frozen into the match so later edits never change a running match.
  async prepareMatch({ tx, room }) {
    if (!room.quizId) throw new DomainError("QUIZ_NOT_PUBLISHED");
    const quiz = await tx.quiz.findUnique({ where: { id: room.quizId }, include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } } });
    if (!quiz || quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
    const snapshot = snapshotFromQuiz(quiz);
    if (!snapshot.questions.length) throw new DomainError("NO_QUESTIONS");
    return { columns: { quizId: quiz.id, quizSnapshot: snapshot } };
  },

  async createParticipantState({ tx, matchParticipant, displayName }) {
    const normalizedName = displayName.toLocaleLowerCase("pt-BR");
    const reconnectTokenHash = await hashToken(randomBytes(32).toString("hex"));
    return createQuizParticipantState(tx, { matchParticipant, displayName, normalizedName, reconnectTokenHash });
  },

  // After a restart: which pending work a live Quiz match still needs.
  recoverMatch({ match }) {
    if (match.matchPhase === "QUESTION") return { kind: "question-deadline", endsAt: match.questionEndsAt };
    if (match.matchPhase === "QUESTION_RESULT") return { kind: "result-advance" };
    return null;
  },
});
