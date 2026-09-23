import { randomBytes } from "node:crypto";
import { DomainError, hashToken } from "@quizarena/database";
import { defineGameRuntime } from "@multygames/game-runtime";
import { QUIZ_GAME_KEY } from "./legacy-compat.js";
import { createQuizParticipantState } from "./participants-repository.js";
import { snapshotFromQuiz } from "./snapshot.js";

// The Quiz's runtime: persistence hooks the platform calls inside its own
// transaction when a Quiz match starts, plus the realtime behaviour. The hooks
// touch only Quiz tables (QuizRoomConfiguration, QuizMatchState,
// QuizParticipantState) and the Quiz content; nothing generic is written here.
export function createQuizRuntime({ rooms, states, realtime }) {
  return defineGameRuntime({
    gameKey: QUIZ_GAME_KEY,
    persistence: {
      // The room's theme must be a published quiz with questions; its snapshot
      // is frozen into the match so later edits never change a running match.
      async prepareMatch({ tx, room }) {
        const quizId = await rooms.quizIdFor(tx, room);
        if (!quizId) throw new DomainError("QUIZ_NOT_PUBLISHED");
        const quiz = await tx.quiz.findUnique({ where: { id: quizId }, include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } } });
        if (!quiz || quiz.status !== "PUBLISHED") throw new DomainError("QUIZ_NOT_PUBLISHED");
        const snapshot = snapshotFromQuiz(quiz);
        if (!snapshot.questions.length) throw new DomainError("NO_QUESTIONS");
        return { prepared: { quizId: quiz.id, snapshot }, compatColumns: states.compatColumns(quiz.id, snapshot) };
      },
      createMatchState: ({ tx, match, prepared }) => states.create(tx, { matchId: match.id, quizId: prepared.quizId, snapshot: prepared.snapshot }),
      async createParticipantState({ tx, matchParticipant, displayName }) {
        const normalizedName = displayName.toLocaleLowerCase("pt-BR");
        const reconnectTokenHash = await hashToken(randomBytes(32).toString("hex"));
        return createQuizParticipantState(tx, { matchParticipant, displayName, normalizedName, reconnectTokenHash });
      },
    },
    realtime,
  });
}
