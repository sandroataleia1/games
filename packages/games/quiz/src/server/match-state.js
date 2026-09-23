import { DomainError } from "@quizarena/database";
import { QUIZ_GAME_KEY } from "./legacy-compat.js";
import { validateSnapshot } from "./snapshot.js";

const PROGRESS = ["matchPhase", "currentQuestionIndex", "questionStartedAt", "questionEndsAt"];
const same = (a, b) => (a instanceof Date || b instanceof Date ? (a?.getTime?.() ?? null) === (b?.getTime?.() ?? null) : (a ?? null) === (b ?? null));

// Quiz match state: snapshot + progress of one Quiz match. Source of truth:
// QuizMatchState (1:1 with GameSession, gameKey 'quiz'). The same values on the
// GameSession row are a legacy mirror (see legacy-compat.js).
export function createQuizMatchState({ compat }) {
  // The state of a match row, from the module table. A Quiz match that only
  // exists in legacy form (created by an old instance after the migration) is
  // materialized once, idempotently and visibly; without the compatibility
  // layer a missing state is an explicit error, never legacy data in disguise.
  async function get(db, session) {
    if (session.gameKey !== QUIZ_GAME_KEY) throw new DomainError("SESSION_NOT_FOUND");
    let state = await db.quizMatchState.findUnique({ where: { matchId: session.id } });
    if (!state) {
      if (!compat.fallback || !session.quizSnapshot || !session.quizId) throw new DomainError("QUIZ_STATE_MISSING");
      await db.quizMatchState.createMany({
        data: [{ matchId: session.id, gameKey: QUIZ_GAME_KEY, quizId: session.quizId, quizSnapshot: session.quizSnapshot, matchPhase: session.matchPhase, currentQuestionIndex: session.currentQuestionIndex, questionStartedAt: session.questionStartedAt, questionEndsAt: session.questionEndsAt, createdAt: session.createdAt }],
        skipDuplicates: true,
      });
      compat.fellBack("match", session.id);
      state = await db.quizMatchState.findUnique({ where: { matchId: session.id } });
    } else if (compat.mirror) {
      const differing = PROGRESS.filter((field) => !same(state[field], session[field]));
      if (differing.length) compat.diverged("match", session.id, { fields: differing });
    }
    return state;
  }
  return {
    get,
    // A GameSession row + its state, shaped like the pre-07C session (what the
    // Quiz service and the realtime runtime have always consumed).
    async view(db, session) {
      const state = await get(db, session);
      const { hostTokenHash, ...rest } = session;
      void hostTokenHash;
      return { ...rest, quizId: state.quizId, quizSnapshot: validateSnapshot(state.quizSnapshot), matchPhase: state.matchPhase, currentQuestionIndex: state.currentQuestionIndex, questionStartedAt: state.questionStartedAt, questionEndsAt: state.questionEndsAt };
    },
    // First insert (match creation): state plus the legacy columns that must
    // be written on the match row itself (returned to the platform as opaque
    // `compatColumns`, because the snapshot trigger forbids adding them later).
    compatColumns(quizId, snapshot) {
      return compat.mirror ? { quizId, quizSnapshot: snapshot } : {};
    },
    create(db, { matchId, quizId, snapshot }) {
      return db.quizMatchState.create({ data: { matchId, gameKey: QUIZ_GAME_KEY, quizId, quizSnapshot: snapshot } });
    },
    // Progress update: module table first, then the mirror, same transaction.
    async update(db, matchId, data) {
      const row = await db.quizMatchState.update({ where: { matchId }, data });
      if (compat.mirror) await db.gameSession.update({ where: { id: matchId }, data });
      return row;
    },
  };
}
