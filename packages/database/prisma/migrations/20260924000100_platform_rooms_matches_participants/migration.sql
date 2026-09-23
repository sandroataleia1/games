-- PLATFORM-07B: generic rooms, matches and participants.
--
-- Additive only: no table or column is dropped or rewritten. Every existing
-- row is preserved with its id, timestamps and state.
--   * Room.gameKey / GameSession.gameKey: every existing room and match runs
--     the Quiz (the only game that ever existed) -> backfilled with 'quiz',
--     the stable key of the Quiz module in packages/game-registry. Added
--     nullable, filled, validated, and only then made NOT NULL.
--   * MatchParticipant: one platform record per existing Participant, with
--     the SAME id and the original joinedAt (no "now()" for known dates).
--     leftAt stays NULL: it never existed, and disconnectedAt is not a leave.
--   * Participant.matchParticipantId = its own id.
-- New constraints protecting the invariants (Prisma cannot express the last
-- two, so they live only in this file):
--   * Room(id, gameKey) unique + GameSession(roomId, gameKey) -> Room(id, gameKey)
--     ON UPDATE RESTRICT: a match can never disagree with its room's game and
--     a room's gameKey cannot change while it has matches. Legacy matches with
--     roomId NULL are not covered (MATCH SIMPLE).
--   * at most ONE live (WAITING/ACTIVE) match per room, even across instances.
-- Pre-flight for a populated database (must return no rows or the unique
-- index below will refuse to build; nothing is modified by that failure):
--   SELECT "roomId", count(*) FROM "GameSession"
--    WHERE "roomId" IS NOT NULL AND "status" IN ('WAITING','ACTIVE')
--    GROUP BY "roomId" HAVING count(*) > 1;

-- Room.gameKey ------------------------------------------------------------
ALTER TABLE "Room" ADD COLUMN "gameKey" TEXT;
UPDATE "Room" SET "gameKey" = 'quiz' WHERE "gameKey" IS NULL;
ALTER TABLE "Room" ALTER COLUMN "gameKey" SET NOT NULL;
CREATE UNIQUE INDEX "Room_id_gameKey_key" ON "Room"("id", "gameKey");
CREATE INDEX "Room_gameKey_number_idx" ON "Room"("gameKey", "number");

-- GameSession.gameKey -----------------------------------------------------
ALTER TABLE "GameSession" ADD COLUMN "gameKey" TEXT;
UPDATE "GameSession" SET "gameKey" = 'quiz' WHERE "gameKey" IS NULL;
ALTER TABLE "GameSession" ALTER COLUMN "gameKey" SET NOT NULL;
CREATE INDEX "GameSession_gameKey_status_idx" ON "GameSession"("gameKey", "status");
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_roomId_gameKey_fkey" FOREIGN KEY ("roomId", "gameKey") REFERENCES "Room"("id", "gameKey") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "GameSession_one_live_match_per_room" ON "GameSession"("roomId") WHERE "roomId" IS NOT NULL AND "status" IN ('WAITING', 'ACTIVE');

-- MatchParticipant --------------------------------------------------------
CREATE TABLE "MatchParticipant" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "userId" UUID,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MatchParticipant_gameSessionId_userId_key" ON "MatchParticipant"("gameSessionId", "userId");
CREATE UNIQUE INDEX "MatchParticipant_id_gameSessionId_key" ON "MatchParticipant"("id", "gameSessionId");
CREATE INDEX "MatchParticipant_userId_idx" ON "MatchParticipant"("userId");
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill: same id, same owner, original join date. Idempotent.
INSERT INTO "MatchParticipant" ("id", "gameSessionId", "userId", "joinedAt")
SELECT p."id", p."gameSessionId", p."userId", p."joinedAt"
FROM "Participant" p
WHERE NOT EXISTS (SELECT 1 FROM "MatchParticipant" m WHERE m."id" = p."id");

-- Participant.matchParticipantId -----------------------------------------
ALTER TABLE "Participant" ADD COLUMN "matchParticipantId" UUID;
UPDATE "Participant" SET "matchParticipantId" = "id" WHERE "matchParticipantId" IS NULL;
ALTER TABLE "Participant" ALTER COLUMN "matchParticipantId" SET NOT NULL;
CREATE UNIQUE INDEX "Participant_matchParticipantId_key" ON "Participant"("matchParticipantId");
CREATE UNIQUE INDEX "Participant_matchParticipantId_gameSessionId_key" ON "Participant"("matchParticipantId", "gameSessionId");
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_matchParticipantId_gameSessionId_fkey" FOREIGN KEY ("matchParticipantId", "gameSessionId") REFERENCES "MatchParticipant"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
