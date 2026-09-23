import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// After `pnpm build`: proves no server-only code reached the web build.
//   .next/static  = what browsers download: no Prisma, no Redis, no server runtime,
//                   no Quiz persistence/state code, no adapter/runtime registry.
//   .next/server  = the web's own server bundle: still never the database client,
//                   the realtime host, the Quiz server or Redis.
const next = fileURLToPath(new URL("../apps/web/.next/", import.meta.url));
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full) : /\.(js|mjs|cjs)$/.test(name) ? [full] : []; }) : []);
const CLIENT = ["@quizarena/game-", "PrismaClient", "@prisma/client", "createServerDatabase", "createQuizServer", "createQuizRealtime", "createQuizRuntime", "createGameRuntimeRegistry", "defineGameRuntime", "createLobbyRuntime", "protect_session_snapshot", "QuizMatchState", "QuizRoomConfiguration", "hostTokenHash", "reconnectTokenHash", "@socket.io/redis-adapter"];
const SERVER = ["@quizarena/game-", "PrismaClient", "createServerDatabase", "createQuizServer", "createQuizRealtime", "createLobbyRuntime", "@socket.io/redis-adapter"];
const scan = (dir, markers) => walk(dir).flatMap((file) => { const code = readFileSync(file, "utf8"); return markers.filter((marker) => code.includes(marker)).map((marker) => `${file.replace(next, "")}: ${marker}`); });

if (!existsSync(join(next, "static"))) { console.error("apps/web/.next não encontrado: rode `pnpm build` antes."); process.exit(2); }
const found = [...scan(join(next, "static"), CLIENT), ...scan(join(next, "server"), SERVER)];
console.log(JSON.stringify({ ok: found.length === 0, clientFiles: walk(join(next, "static")).length, serverFiles: walk(join(next, "server")).length, found: found.slice(0, 20) }));
process.exitCode = found.length ? 1 : 0;
