import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/client.js";
import { isolatedTestUrl } from "./environment.js";
import { unexpectedDrift, verifySqlObjects } from "./sql-objects.js";

// `pnpm db:verify`: schema integrity WITHOUT touching development or production.
// Runs against the isolated test schema (apply migrations first: db:test:prepare).
//   1. prisma validate;
//   2. prisma migrate diff (migrated test schema -> schema.prisma): only the
//      allowlisted cosmetic statements may appear - anything else is drift;
//   3. the SQL-only objects and guard constraints exist in pg_catalog.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const prisma = (args, env) => spawnSync(process.execPath, [createRequire(import.meta.url).resolve("prisma/build/index.js"), ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });

export async function runVerify() {
  const url = isolatedTestUrl();
  const schemaName = new URL(url).searchParams.get("schema");
  const problems = [];
  const validated = prisma(["validate"], { DATABASE_URL: url });
  if (validated.status !== 0) problems.push(`prisma validate falhou:\n${validated.stdout}${validated.stderr}`);
  const diff = prisma(["migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { DATABASE_URL: url });
  if (diff.status !== 0) problems.push(`prisma migrate diff falhou:\n${diff.stderr}`);
  else {
    const drift = unexpectedDrift(diff.stdout, schemaName);
    if (drift.length) problems.push(`drift entre as migrations e schema.prisma:\n${drift.join("\n")}`);
  }
  const client = createClient(url);
  try {
    for (const object of await verifySqlObjects(client)) problems.push(`objeto SQL ausente: ${object.kind} ${object.name} (${object.purpose})`);
  } finally {
    await client.$disconnect();
  }
  return problems;
}
