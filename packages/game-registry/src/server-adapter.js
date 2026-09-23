import { z } from "zod";

// What the platform (rooms/matches/participants) needs from a game to run one
// of its matches. Deliberately minimal - only what the Quiz already needs:
//   prepareMatch          validate the room's game-specific setup and return
//                         the game's own columns for the match row
//   createParticipantState  create the game's per-participant state (score,
//                         answers...) for a platform MatchParticipant
//   recoverMatch          after a restart, say which pending work (timers)
//                         a live match still needs; null when none
// The core calls these through the registry, never by branching on gameKey.
export const SERVER_ADAPTER_METHODS = Object.freeze(["prepareMatch", "createParticipantState", "recoverMatch"]);

const adapterSchema = z
  .object({
    gameKey: z.string().min(1),
    prepareMatch: z.function(),
    createParticipantState: z.function(),
    recoverMatch: z.function(),
  })
  .strict();

export function defineGameServerAdapter(adapter) {
  adapterSchema.parse(adapter);
  return Object.freeze({ ...adapter });
}

// Maps gameKey -> server adapter, checked against the registry: an adapter for
// an unregistered game is refused, and every AVAILABLE game that declares a
// realtime implementation must have one (fail at startup, not on first match).
export function createServerAdapterRegistry({ registry, adapters = [] }) {
  const byKey = new Map();
  for (const adapter of adapters.map(defineGameServerAdapter)) {
    if (!registry.getByKey(adapter.gameKey)) throw new Error(`game-registry: adaptador para jogo não registrado "${adapter.gameKey}"`);
    if (byKey.has(adapter.gameKey)) throw new Error(`game-registry: adaptador duplicado "${adapter.gameKey}"`);
    byKey.set(adapter.gameKey, adapter);
  }
  for (const module of registry.listAvailable()) {
    if (module.implementation.realtime && !byKey.has(module.definition.key)) {
      throw new Error(`game-registry: jogo "${module.definition.key}" está disponível mas não tem adaptador de servidor`);
    }
  }
  return Object.freeze({
    get: (gameKey) => byKey.get(gameKey) ?? null,
    has: (gameKey) => byKey.has(gameKey),
  });
}
