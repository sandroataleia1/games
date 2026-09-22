-- Game portal: room visibility (PUBLIC/PRIVATE), authenticated host,
-- and accounts linked to participants (one participation per account per
-- session). Fully additive: new nullable columns, new default, loosened
-- (not removed) name index. No backfill needed; existing rows keep
-- hostUserId/userId = NULL and visibility = PUBLIC.

-- CreateEnum
CREATE TYPE "RoomVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- DropIndex
DROP INDEX "Participant_gameSessionId_normalizedName_key";

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "hostUserId" UUID,
ADD COLUMN     "visibility" "RoomVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "userId" UUID;

-- CreateIndex
CREATE INDEX "GameSession_quizId_visibility_status_idx" ON "GameSession"("quizId", "visibility", "status");

-- CreateIndex
CREATE INDEX "Participant_gameSessionId_normalizedName_idx" ON "Participant"("gameSessionId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_gameSessionId_userId_key" ON "Participant"("gameSessionId", "userId");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
