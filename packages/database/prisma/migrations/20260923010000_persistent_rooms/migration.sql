-- Persistent, ownerless game rooms: a fixed numbered pool of rooms
-- that always exist. A room holds a selectable theme (quiz) while
-- OPEN and points at the active GameSession while PLAYING. Fully
-- additive: new table, new nullable column, loosened NOT NULL on
-- GameSession.hostTokenHash (no host concept in the new flow).
-- No existing rows are modified or removed.

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'PLAYING');

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "roomId" UUID,
ALTER COLUMN "hostTokenHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "quizId" UUID,
    "currentSessionId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_number_key" ON "Room"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Room_currentSessionId_key" ON "Room"("currentSessionId");

-- CreateIndex
CREATE INDEX "GameSession_roomId_idx" ON "GameSession"("roomId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_currentSessionId_fkey" FOREIGN KEY ("currentSessionId") REFERENCES "GameSession"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Seed the fixed pool of 12 persistent rooms (idempotent).
INSERT INTO "Room" ("id", "number")
SELECT gen_random_uuid(), n
FROM generate_series(1, 12) AS n
WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE "Room"."number" = n);
