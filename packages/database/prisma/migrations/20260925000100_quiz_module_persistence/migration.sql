-- PLATFORM-07C: Quiz persistence moves out of the generic tables.
-- Strategy: EXPAND -> MIGRATE (this file) -> new app reads/writes the module
-- tables (legacy columns are mirrored for rollout) -> CONTRACT later
-- (docs/ADR-009). Nothing is dropped or rewritten here except one redundant
-- constraint (see 1). Atomic: if any pre-flight fails, nothing is applied.

-- 1. EXPAND ----------------------------------------------------------------
-- GameSession(roomId) -> Room(id) is fully covered by the composite FK
-- GameSession(roomId, gameKey) -> Room(id, gameKey) from PLATFORM-07B, which
-- Prisma can model; the single-column copy is redundant and is replaced.
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_roomId_fkey";
CREATE UNIQUE INDEX "GameSession_id_gameKey_key" ON "GameSession"("id", "gameKey");

-- Quiz room configuration: which quiz is the theme of a Quiz room. 1:1 with
-- Room. The constant gameKey (CHECK) + composite FK make it impossible for a
-- room of another game to have one, and freeze the room's game while it does.
CREATE TABLE "QuizRoomConfiguration" (
    "roomId" UUID NOT NULL,
    "gameKey" TEXT NOT NULL DEFAULT 'quiz',
    "quizId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizRoomConfiguration_pkey" PRIMARY KEY ("roomId"),
    CONSTRAINT "QuizRoomConfiguration_gameKey_check" CHECK ("gameKey" = 'quiz')
);
CREATE UNIQUE INDEX "QuizRoomConfiguration_roomId_gameKey_key" ON "QuizRoomConfiguration"("roomId", "gameKey");
CREATE INDEX "QuizRoomConfiguration_quizId_idx" ON "QuizRoomConfiguration"("quizId");
ALTER TABLE "QuizRoomConfiguration" ADD CONSTRAINT "QuizRoomConfiguration_roomId_gameKey_fkey" FOREIGN KEY ("roomId", "gameKey") REFERENCES "Room"("id", "gameKey") ON DELETE CASCADE ON UPDATE RESTRICT;
-- A theme is a selection, not history: deleting its quiz clears it (as Room.quizId did with SET NULL).
ALTER TABLE "QuizRoomConfiguration" ADD CONSTRAINT "QuizRoomConfiguration_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Quiz match state: snapshot and progress of a Quiz match. 1:1 with
-- GameSession, only for gameKey 'quiz'. History: a quiz used by a match can
-- never be deleted (RESTRICT), and neither can the match.
CREATE TABLE "QuizMatchState" (
    "matchId" UUID NOT NULL,
    "gameKey" TEXT NOT NULL DEFAULT 'quiz',
    "quizId" UUID NOT NULL,
    "quizSnapshot" JSONB NOT NULL,
    "matchPhase" "MatchPhase" NOT NULL DEFAULT 'LOBBY',
    "currentQuestionIndex" INTEGER,
    "questionStartedAt" TIMESTAMPTZ(3),
    "questionEndsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizMatchState_pkey" PRIMARY KEY ("matchId"),
    CONSTRAINT "QuizMatchState_gameKey_check" CHECK ("gameKey" = 'quiz'),
    CONSTRAINT "QuizMatchState_snapshot_root_valid" CHECK (COALESCE(jsonb_typeof("quizSnapshot") = 'object'
      AND "quizSnapshot" -> 'schemaVersion' = '1'::jsonb
      AND "quizSnapshot" ->> 'quizId' = "quizId"::text
      AND CASE WHEN jsonb_typeof("quizSnapshot" -> 'questions') = 'array'
        THEN jsonb_array_length("quizSnapshot" -> 'questions') > 0 ELSE FALSE END, FALSE))
);
CREATE UNIQUE INDEX "QuizMatchState_matchId_gameKey_key" ON "QuizMatchState"("matchId", "gameKey");
CREATE INDEX "QuizMatchState_quizId_idx" ON "QuizMatchState"("quizId");
CREATE INDEX "QuizMatchState_matchPhase_idx" ON "QuizMatchState"("matchPhase");
ALTER TABLE "QuizMatchState" ADD CONSTRAINT "QuizMatchState_matchId_gameKey_fkey" FOREIGN KEY ("matchId", "gameKey") REFERENCES "GameSession"("id", "gameKey") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "QuizMatchState" ADD CONSTRAINT "QuizMatchState_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The snapshot of a Quiz match never changes (same rule as the legacy column).
CREATE TRIGGER "QuizMatchState_snapshot_immutable"
BEFORE UPDATE ON "QuizMatchState"
FOR EACH ROW EXECUTE FUNCTION protect_session_snapshot();

-- 2. MIGRATE ---------------------------------------------------------------
-- Pre-flight: refuse to guess. Any row that cannot be classified aborts the
-- whole migration (nothing above or below is kept).
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Room" WHERE "quizId" IS NOT NULL AND "gameKey" <> 'quiz';
  IF bad > 0 THEN
    RAISE EXCEPTION 'PLATFORM-07C: % room(s) reference a quiz but do not belong to the quiz game', bad USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO bad FROM "GameSession" WHERE ("quizId" IS NOT NULL OR "quizSnapshot" IS NOT NULL) AND "gameKey" <> 'quiz';
  IF bad > 0 THEN
    RAISE EXCEPTION 'PLATFORM-07C: % match(es) carry quiz state but do not belong to the quiz game', bad USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO bad FROM "GameSession" WHERE "gameKey" = 'quiz' AND ("quizId" IS NULL OR "quizSnapshot" IS NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'PLATFORM-07C: % quiz match(es) have no quiz snapshot', bad USING ERRCODE = '23514';
  END IF;
END
$$;

-- Deterministic and idempotent: original ids and stored timestamps, never now().
INSERT INTO "QuizRoomConfiguration" ("roomId", "gameKey", "quizId", "createdAt", "updatedAt")
SELECT r."id", 'quiz', r."quizId", r."updatedAt", r."updatedAt"
FROM "Room" r
WHERE r."quizId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "QuizRoomConfiguration" c WHERE c."roomId" = r."id");

INSERT INTO "QuizMatchState" ("matchId", "gameKey", "quizId", "quizSnapshot", "matchPhase", "currentQuestionIndex", "questionStartedAt", "questionEndsAt", "createdAt", "updatedAt")
SELECT g."id", 'quiz', g."quizId", g."quizSnapshot", g."matchPhase", g."currentQuestionIndex", g."questionStartedAt", g."questionEndsAt", g."createdAt",
       COALESCE(g."finishedAt", g."questionStartedAt", g."startedAt", g."createdAt")
FROM "GameSession" g
WHERE g."gameKey" = 'quiz'
  AND NOT EXISTS (SELECT 1 FROM "QuizMatchState" s WHERE s."matchId" = g."id");
