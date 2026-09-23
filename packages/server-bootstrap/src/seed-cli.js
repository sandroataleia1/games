import { config } from "dotenv";
import { runSeed } from "@multygames/game-quiz/server";

config({ path: new URL("../../database/.env", import.meta.url), quiet: true });
runSeed().catch(() => {
  console.error("Falha no seed: confira conexão, migration e possível SEED_CONFLICT.");
  process.exitCode = 1;
});
