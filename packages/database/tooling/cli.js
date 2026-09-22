import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnvironment, isolatedTestUrl } from "./environment.js";

loadEnvironment();
const command = process.argv[2];
const commands = {
  generate: ["generate"],
  migrate: ["migrate", "deploy"],
  studio: ["studio", "--browser", "none", "--hostname", "127.0.0.1"],
  "test:prepare": ["migrate", "deploy"],
};
if (command === "seed") {
  const { runSeed } = await import("../prisma/seed.js");
  await runSeed();
} else {
  if (!commands[command]) throw new Error("Comando de banco desconhecido");
  const env = { ...process.env };
  if (command === "test:prepare") env.DATABASE_URL = isolatedTestUrl();
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), ...commands[command]],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
