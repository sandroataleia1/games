ALTER TYPE "GameSessionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "MatchPhase" AS ENUM ('LOBBY', 'QUESTION', 'QUESTION_RESULT', 'FINISHED');

ALTER TABLE "GameSession"
  ADD COLUMN "matchPhase" "MatchPhase" NOT NULL DEFAULT 'LOBBY',
  ADD COLUMN "currentQuestionIndex" INTEGER,
  ADD COLUMN "questionStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "questionEndsAt" TIMESTAMPTZ(3);

UPDATE "GameSession" SET "matchPhase" = 'FINISHED' WHERE "status" = 'FINISHED';