CREATE TABLE "Organizer" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organizer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organizer_email_key" ON "Organizer"("email");

CREATE TABLE "OrganizerSession" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizerSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizerSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "OrganizerSession_tokenHash_key" ON "OrganizerSession"("tokenHash");
CREATE INDEX "OrganizerSession_ownerId_expiresAt_idx" ON "OrganizerSession"("ownerId", "expiresAt");
CREATE INDEX "OrganizerSession_expiresAt_idx" ON "OrganizerSession"("expiresAt");

ALTER TABLE "Quiz" ADD COLUMN "ownerId" UUID, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
WITH legacy_owner AS (
  INSERT INTO "Organizer" ("id", "name", "email", "passwordHash")
  SELECT gen_random_uuid(), 'Conteúdo legado', 'legacy-' || gen_random_uuid()::text || '@migration.invalid', 'scrypt$v1$disabled$disabled'
  WHERE EXISTS (SELECT 1 FROM "Quiz")
  RETURNING "id"
)
UPDATE "Quiz" SET "ownerId" = (SELECT "id" FROM legacy_owner) WHERE "ownerId" IS NULL;
ALTER TABLE "Quiz" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Quiz_ownerId_updatedAt_idx" ON "Quiz"("ownerId", "updatedAt");

ALTER TABLE "Organizer" ADD CONSTRAINT "Organizer_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 100);
ALTER TABLE "Organizer" ADD CONSTRAINT "Organizer_email_check" CHECK ("email" = lower(btrim("email")) AND char_length("email") <= 254);
ALTER TABLE "Organizer" ADD CONSTRAINT "Organizer_password_hash_check" CHECK ("passwordHash" LIKE 'scrypt$v1$%');
ALTER TABLE "OrganizerSession" ADD CONSTRAINT "OrganizerSession_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_version_check" CHECK ("version" > 0);
