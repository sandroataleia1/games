-- PLATFORM-07B (part 2): a match no longer requires Quiz state.
-- quizId/quizSnapshot are Quiz-specific columns that lived on the generic match
-- row as NOT NULL; a match of any other game could never be stored. Loosening
-- (not removing) them changes no existing row: every current match keeps its
-- quizId and snapshot, and only the Quiz adapter/service ever write them.
ALTER TABLE "GameSession" ALTER COLUMN "quizId" DROP NOT NULL;
ALTER TABLE "GameSession" ALTER COLUMN "quizSnapshot" DROP NOT NULL;
