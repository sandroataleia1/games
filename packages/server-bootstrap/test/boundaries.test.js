import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { ESLint } from "eslint";

// Static guarantees behind ADR-009. They read source files only (no database).
const root = fileURLToPath(new URL("../../../", import.meta.url));
const walk = (dir, filter = (file) => file.endsWith(".js")) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, filter) : filter(full) ? [full] : [];
  });
};
const sourcesOf = (...dirs) => dirs.flatMap((dir) => walk(join(root, dir)));
const read = (file) => readFileSync(file, "utf8");
const rel = (file) => relative(root, file).replaceAll("\\", "/");
const importsOf = (code) => [...code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((match) => match[1]);

const CORE = ["packages/database/src", "packages/database/tooling", "packages/game-runtime/src", "apps/realtime/src"];

test("no code that selects an implementation by gameKey exists in the core or the host", () => {
  const offenders = [];
  for (const file of sourcesOf(...CORE)) {
    const code = read(file);
    if (/(?<!typeof\s)\bgameKey\s*(===|!==|==|!=)\s*["']/.test(code)) offenders.push(`${rel(file)}: comparação de gameKey com literal`);
    if (/switch\s*\(\s*[\w.?]*gameKey/.test(code)) offenders.push(`${rel(file)}: switch (gameKey)`);
    if (/\bQUIZ_GAME_KEY\b|quizGame\b/.test(code)) offenders.push(`${rel(file)}: referência direta ao Quiz`);
  }
  expect(offenders).toEqual([]);
});

test("the platform core and the generic host contain no Quiz persistence or protocol vocabulary", () => {
  const forbidden = /quizId|quizSnapshot|matchPhase|currentQuestionIndex|questionEndsAt|quizMatchState|quizRoomConfiguration|quizParticipantState|game-quiz/;
  const offenders = sourcesOf("packages/database/src", "packages/game-runtime/src", "apps/realtime/src")
    .filter((file) => forbidden.test(read(file).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n")))
    .map(rel);
  expect(offenders).toEqual([]);
});

test("the platform core imports no game, catalog or bootstrap package", () => {
  const offenders = sourcesOf("packages/database/src", "packages/database/tooling").flatMap((file) => importsOf(read(file)).filter((name) => name.startsWith("@multygames/")).map((name) => `${rel(file)} -> ${name}`));
  expect(offenders).toEqual([]);
  const database = JSON.parse(read(join(root, "packages/database/package.json")));
  expect(Object.keys({ ...database.dependencies, ...database.devDependencies }).filter((name) => name.startsWith("@multygames/"))).toEqual([]);
});

test("the portal imports no server code and does not depend on server packages", () => {
  const banned = /^(@quizarena\/database|@multygames\/(game-runtime|server-bootstrap)|@multygames\/game-quiz\/.+|@prisma\/client|redis|socket\.io|@socket\.io\/.+)$/;
  const offenders = walk(join(root, "apps/web/src"), (file) => /\.(js|jsx)$/.test(file)).flatMap((file) => importsOf(read(file)).filter((name) => banned.test(name)).map((name) => `${rel(file)} -> ${name}`));
  expect(offenders).toEqual([]);
  const web = JSON.parse(read(join(root, "apps/web/package.json")));
  const deps = Object.keys({ ...web.dependencies, ...web.devDependencies });
  for (const name of ["@quizarena/database", "@multygames/game-runtime", "@multygames/server-bootstrap", "@prisma/client", "redis", "socket.io"]) expect(deps).not.toContain(name);
});

test("the Quiz definition is web-safe: it imports only the public registry", () => {
  for (const file of ["packages/games/quiz/src/index.js", "packages/games/quiz/src/definition.js"]) {
    for (const name of importsOf(read(join(root, file)))) expect(["@multygames/game-registry", "./definition.js"]).toContain(name);
  }
  const catalog = importsOf(read(join(root, "packages/game-catalog/src/index.js")));
  expect(catalog.sort()).toEqual(["@multygames/game-quiz", "@multygames/game-registry"]);
});

test("the Quiz server code does not import the composition root, the catalog or the transport", () => {
  const banned = /^(@multygames\/(server-bootstrap|game-catalog)|socket\.io|redis|@socket\.io\/.+)$/;
  const offenders = sourcesOf("packages/games/quiz/src/server").flatMap((file) => importsOf(read(file)).filter((name) => banned.test(name)).map((name) => `${rel(file)} -> ${name}`));
  expect(offenders).toEqual([]);
});

test("new packages use the @multygames namespace; the legacy @quizarena packages are the documented exceptions", () => {
  const manifests = ["packages/game-registry", "packages/game-runtime", "packages/game-catalog", "packages/games/quiz", "packages/server-bootstrap"].map((dir) => JSON.parse(read(join(root, dir, "package.json"))).name);
  expect(manifests.every((name) => name.startsWith("@multygames/"))).toBe(true);
  const legacy = ["packages/contracts", "packages/database", "apps/web", "apps/realtime"].map((dir) => JSON.parse(read(join(root, dir, "package.json"))).name);
  expect(legacy).toEqual(["@quizarena/contracts", "@quizarena/database", "@quizarena/web", "@quizarena/realtime"]);
  // Nothing (outside historical ADRs and the lockfile) still points at the old game-* names.
  // (ADR-005 is history, ADR-009 documents the rename and the bundle check looks for the old name on purpose.)
  const exempt = (file) => file.includes("ADR-005") || file.includes("ADR-009") || file.endsWith("check-web-bundle.js");
  const stale = [...sourcesOf("apps", "packages", "scripts"), ...walk(join(root, "docs"), (file) => file.endsWith(".md"))]
    .filter((file) => !exempt(file) && /@quizarena\/game-/.test(read(file))).map(rel);
  expect(stale).toEqual([]);
  expect(/@quizarena\/game-/.test(read(join(root, "pnpm-lock.yaml")))).toBe(false);
});

test("the ESLint boundary rules really reject the forbidden imports", async () => {
  const eslint = new ESLint({ cwd: root });
  const check = async (filePath, code) => (await eslint.lintText(code, { filePath: join(root, filePath) }))[0].messages.filter((message) => message.ruleId === "no-restricted-imports");
  expect(await check("packages/database/src/x.js", 'import { quizGame } from "@multygames/game-quiz";')).toHaveLength(1);
  expect(await check("apps/realtime/src/x.js", 'import { quizGame } from "@multygames/game-quiz";')).toHaveLength(1);
  expect(await check("packages/games/quiz/src/definition.js", 'import { db } from "@quizarena/database";')).toHaveLength(1);
  expect(await check("packages/games/quiz/src/server/x.js", 'import { c } from "@multygames/game-catalog";')).toHaveLength(1);
  expect(await check("packages/database/src/x.js", 'import { z } from "zod";')).toHaveLength(0);
});
