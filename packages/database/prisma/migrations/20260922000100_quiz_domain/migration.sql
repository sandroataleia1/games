BEGIN;
-- CreateSchema
-- Schema de destino criado pelo Prisma Migrate a partir da URL.

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('WAITING', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'SINGLE_CHOICE',
    "durationSeconds" INTEGER NOT NULL,
    "basePoints" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "roomCode" TEXT NOT NULL,
    "quizId" UUID NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'WAITING',
    "hostTokenHash" TEXT NOT NULL,
    "quizSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "reconnectTokenHash" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "questionRef" UUID NOT NULL,
    "selectedOptionRef" UUID NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "answeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quiz_status_idx" ON "Quiz"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Question_quizId_position_key" ON "Question"("quizId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_position_key" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_roomCode_key" ON "GameSession"("roomCode");

-- CreateIndex
CREATE INDEX "GameSession_status_createdAt_idx" ON "GameSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GameSession_quizId_idx" ON "GameSession"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_gameSessionId_normalizedName_key" ON "Participant"("gameSessionId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_id_gameSessionId_key" ON "Participant"("id", "gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_gameSessionId_participantId_questionRef_key" ON "Answer"("gameSessionId", "participantId", "questionRef");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_participantId_gameSessionId_fkey" FOREIGN KEY ("participantId", "gameSessionId") REFERENCES "Participant"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Invariantes escalares complementares ao schema Prisma.
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_title_valid"
  CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 300);
ALTER TABLE "Question" ADD CONSTRAINT "Question_values_valid"
  CHECK ("position" > 0 AND char_length(btrim("prompt")) > 0
    AND "durationSeconds" BETWEEN 5 AND 120 AND "basePoints" BETWEEN 100 AND 10000);
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_values_valid"
  CHECK ("position" > 0 AND char_length(btrim("text")) > 0);
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_values_valid"
  CHECK ("score" >= 0 AND char_length(btrim("displayName")) > 0
    AND char_length(btrim("normalizedName")) > 0);
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_values_valid"
  CHECK ("responseTimeMs" >= 0 AND "pointsAwarded" >= 0);
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_code_valid"
  CHECK ("roomCode" ~ '^[A-Z0-9]{4,12}$');
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hash_format"
  CHECK ("hostTokenHash" ~ '^scrypt[$]v1[$][0-9a-f]{32}[$][0-9a-f]{128}$');
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_hash_format"
  CHECK ("reconnectTokenHash" ~ '^scrypt[$]v1[$][0-9a-f]{32}[$][0-9a-f]{128}$');
-- O schema Zod valida o conteúdo completo. O banco valida a raiz e o vínculo.
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_snapshot_root_valid"
  CHECK (COALESCE(jsonb_typeof("quizSnapshot") = 'object'
    AND "quizSnapshot" -> 'schemaVersion' = '1'::jsonb
    AND "quizSnapshot" ->> 'quizId' = "quizId"::text
    AND CASE WHEN jsonb_typeof("quizSnapshot" -> 'questions') = 'array'
      THEN jsonb_array_length("quizSnapshot" -> 'questions') > 0 ELSE FALSE END, FALSE));

-- JSONB compara conteúdo, sem depender da ordem das chaves.
-- Alterar status/datas permanece permitido; o snapshot e seu quiz de origem não.
CREATE FUNCTION protect_session_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."quizSnapshot" IS DISTINCT FROM OLD."quizSnapshot"
     OR NEW."quizId" IS DISTINCT FROM OLD."quizId" THEN
    RAISE EXCEPTION 'GameSession snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GameSession_snapshot_immutable"
BEFORE UPDATE ON "GameSession"
FOR EACH ROW EXECUTE FUNCTION protect_session_snapshot();

COMMIT;
