import { config } from "dotenv";
import { createClient } from "@quizarena/database";
import { auditQuizLegacy } from "@multygames/game-quiz/server";

// READ-ONLY audit: compares the Quiz legacy columns with the module tables
// (ADR-009). Exit code 0 = no divergence (the legacy columns are safe to drop
// in the contract migration), 1 = findings. Only SELECTs are issued.
//   pnpm db:audit-quiz            (uses DATABASE_URL)
//   AUDIT_DATABASE_URL=... pnpm db:audit-quiz
config({ path: new URL("../../database/.env", import.meta.url), quiet: true });
const client = createClient(process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL);
try {
  const result = await auditQuizLegacy(client);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await client.$disconnect();
}
