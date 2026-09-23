// Database objects that exist ONLY in migration SQL because the Prisma schema
// cannot express them (partial unique index, CHECK constraints, the snapshot
// trigger and its function). `prisma migrate diff` cannot see them either, so a
// future migration could drop them silently: this list is checked against
// pg_catalog after the migrations (see `pnpm db:verify` and its test), and the
// prose reasons live in docs/ADR-009.
export const SQL_ONLY_OBJECTS = Object.freeze([
  { kind: "index", table: "GameSession", name: "GameSession_one_live_match_per_room", purpose: "one live (WAITING/ACTIVE) match per room, across instances", partial: true },
  { kind: "check", table: "GameSession", name: "GameSession_snapshot_root_valid", purpose: "legacy Quiz snapshot root; allows a match with no Quiz state" },
  { kind: "trigger", table: "GameSession", name: "GameSession_snapshot_immutable", purpose: "legacy Quiz snapshot never changes" },
  { kind: "function", name: "protect_session_snapshot", purpose: "shared by both snapshot immutability triggers" },
  { kind: "check", table: "QuizRoomConfiguration", name: "QuizRoomConfiguration_gameKey_check", purpose: "Quiz configuration only for the 'quiz' game" },
  { kind: "check", table: "QuizMatchState", name: "QuizMatchState_gameKey_check", purpose: "Quiz state only for the 'quiz' game" },
  { kind: "check", table: "QuizMatchState", name: "QuizMatchState_snapshot_root_valid", purpose: "Quiz state snapshot root and quizId link" },
  { kind: "trigger", table: "QuizMatchState", name: "QuizMatchState_snapshot_immutable", purpose: "Quiz snapshot of a match never changes" },
]);

// Objects Prisma models but whose loss would break invariants, verified too so a
// bad migration cannot remove them unnoticed.
export const MODELLED_GUARDS = Object.freeze([
  { kind: "foreign key", table: "GameSession", name: "GameSession_roomId_gameKey_fkey", purpose: "match game equals room game; room game frozen once it has matches" },
  { kind: "foreign key", table: "QuizRoomConfiguration", name: "QuizRoomConfiguration_roomId_gameKey_fkey", purpose: "configuration only on a Quiz room" },
  { kind: "foreign key", table: "QuizMatchState", name: "QuizMatchState_matchId_gameKey_fkey", purpose: "state only on a Quiz match" },
  { kind: "foreign key", table: "QuizMatchState", name: "QuizMatchState_quizId_fkey", purpose: "history: a used quiz cannot be deleted" },
  { kind: "foreign key", table: "Participant", name: "Participant_matchParticipantId_gameSessionId_fkey", purpose: "Quiz participant state shares its platform participant, same match" },
  { kind: "unique index", table: "MatchParticipant", name: "MatchParticipant_gameSessionId_userId_key", purpose: "one participation per account per match" },
]);

const constraint = (type) => (o) => `SELECT 1 FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND k.conname = '${o.name}' AND k.contype = '${type}' AND t.relname = '${o.table}'`;
const uniqueIndex = (partial) => (o) => `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = '${o.name}' AND i.indisunique AND ${partial && o.partial ? "i.indpred IS NOT NULL" : "TRUE"}`;
const QUERIES = {
  index: uniqueIndex(true),
  "unique index": uniqueIndex(false),
  check: constraint("c"),
  "foreign key": constraint("f"),
  trigger: (o) => `SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND g.tgname = '${o.name}' AND NOT g.tgisinternal AND t.relname = '${o.table}'`,
  function: (o) => `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.proname = '${o.name}'`,
};

// Returns the objects that are missing. Read-only; needs a client on the schema to check.
export async function verifySqlObjects(client) {
  const missing = [];
  for (const object of [...SQL_ONLY_OBJECTS, ...MODELLED_GUARDS]) {
    const rows = await client.$queryRawUnsafe(QUERIES[object.kind](object));
    if (rows.length === 0) missing.push(object);
  }
  return missing;
}

// Statements `prisma migrate diff` may still report between the migrated
// database and schema.prisma: a known cosmetic default (Prisma drops the
// CURRENT_TIMESTAMP default of @updatedAt columns). Anything else is drift.
export const ALLOWED_PRISMA_DRIFT = Object.freeze([
  'ALTER TABLE "Organizer" ALTER COLUMN "updatedAt" DROP DEFAULT;',
  'ALTER TABLE "Room" ALTER COLUMN "updatedAt" DROP DEFAULT;',
]);

export function unexpectedDrift(script, schemaName) {
  const normalize = (line) => line.replaceAll(`"${schemaName}".`, "");
  return script
    .split("\n")
    .map((line) => normalize(line.trim()))
    .filter((line) => line && !line.startsWith("--"))
    .filter((line) => !ALLOWED_PRISMA_DRIFT.includes(line));
}
