import { quizGame } from "../definition.js";

// The Quiz's own game key, read from its definition - never retyped.
export const QUIZ_GAME_KEY = quizGame.definition.key;

// ROLLOUT COMPATIBILITY (ADR-009). Before PLATFORM-07C the Quiz kept its state
// on Room.quizId and on GameSession.{quizId, quizSnapshot, matchPhase,
// currentQuestionIndex, questionStartedAt, questionEndsAt}. The module tables
// (QuizRoomConfiguration, QuizMatchState) are now the source of truth. While a
// previous release may still be running:
//   mirror    every write to the module tables is mirrored, in the same
//             transaction, onto the legacy columns, so an old instance keeps
//             seeing correct data;
//   fallback  a Quiz row that only exists in legacy form (created by an old
//             instance after the migration) is materialized into the module
//             tables, idempotently, the first time it is read.
// Both are explicit and observable: every fallback and every mirror/primary
// disagreement is logged and counted, and `scripts/audit-quiz-legacy.js`
// reports them. The module tables always win. Turn everything off with
// LEGACY_QUIZ_COMPAT=off once no old instance runs (then run the audit).
export function createLegacyCompat({ enabled = true, logger = console } = {}) {
  const counters = { fallbacks: 0, divergences: 0 };
  return Object.freeze({
    mirror: enabled,
    fallback: enabled,
    counters,
    fellBack(kind, id) {
      counters.fallbacks += 1;
      logger.warn?.(`[quiz-compat] fallback: ${kind} ${id} materialized from legacy columns`);
    },
    diverged(kind, id, detail) {
      counters.divergences += 1;
      logger.warn?.(`[quiz-compat] divergence: ${kind} ${id} ${JSON.stringify(detail)}; module table wins`);
    },
  });
}

export function legacyCompatFromEnvironment(value, logger) {
  return createLegacyCompat({ enabled: String(value ?? "on").toLowerCase() !== "off", logger });
}
