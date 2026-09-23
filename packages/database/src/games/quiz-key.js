import { quizGame } from "@quizarena/game-quiz";

// The stable registry key of the Quiz, read from its module - never retyped.
// Only the Quiz-specific services (quiz management, the legacy hosted flow and
// the Quiz adapter) use it; the platform core never does.
export const QUIZ_GAME_KEY = quizGame.definition.key;
