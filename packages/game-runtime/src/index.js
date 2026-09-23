import { z } from "zod";

// SERVER-side contract of a game. The public catalog (@multygames/game-registry)
// only describes a game; a runtime is what actually runs it, so it lives in a
// separate registry that only server code (realtime, bootstrap, tests) imports.
// Nothing in a runtime is ever serialized to a client.
//
//   persistence  what the platform calls inside its own transaction when a
//                match starts, so a game keeps its state in ITS tables:
//     prepareMatch({ tx, room })                 validate the room's setup; return
//                                                { prepared, compatColumns? }
//     createMatchState({ tx, match, prepared })  create the game's match state
//     createParticipantState({ tx, match, matchParticipant, displayName })
//   realtime     what the generic realtime host delegates to the game:
//     roomProjection                             { schema, extras(room) } extra public
//                                                fields of the room state
//     registerHandlers(host)                     bind the game's own events
//     onRoomEnter / onRoomLeave / onSocketDisconnect / onMatchStarted
//     recoverMatch({ match, room })              rebuild what a live match needs
//                                                after a restart (timers), or nothing
// There is deliberately no generic "command" method: a game's commands are its
// own events, bound in registerHandlers.
export const RUNTIME_PERSISTENCE_HOOKS = Object.freeze(["prepareMatch", "createMatchState", "createParticipantState"]);
export const RUNTIME_REALTIME_HOOKS = Object.freeze(["registerHandlers", "onRoomEnter", "onRoomLeave", "onSocketDisconnect", "onMatchStarted", "recoverMatch"]);

const fn = () => z.custom((value) => typeof value === "function", "deve ser função");
const runtimeSchema = z
  .object({
    gameKey: z.string().regex(/^[a-z][a-z0-9-]*$/),
    persistence: z.object(Object.fromEntries(RUNTIME_PERSISTENCE_HOOKS.map((name) => [name, fn()]))).strict(),
    realtime: z
      .object({
        roomProjection: z.object({ schema: z.custom((value) => value && typeof value.parse === "function", "deve ser um schema"), extras: fn() }).strict(),
        ...Object.fromEntries(RUNTIME_REALTIME_HOOKS.map((name) => [name, fn()])),
        close: fn().optional(),
      })
      .strict(),
  })
  .strict();

function freezeShallow(runtime) {
  return Object.freeze({ ...runtime, persistence: Object.freeze({ ...runtime.persistence }), realtime: Object.freeze({ ...runtime.realtime }) });
}

export function defineGameRuntime(runtime) {
  runtimeSchema.parse(runtime);
  return freezeShallow(runtime);
}

// Server registry, validated against the public catalog and immutable after
// construction:
//  - keys are unique and must exist in the catalog (no runtime without a definition);
//  - an AVAILABLE game that declares `implementation.realtime` must have one
//    (the process refuses to start rather than fail on the first match);
//  - a DISABLED/COMING_SOON game may keep or lack a runtime: its history is
//    readable through the platform, it just cannot start new matches.
export function createGameRuntimeRegistry({ catalog, runtimes = [] }) {
  const byKey = new Map();
  for (const runtime of runtimes.map(defineGameRuntime)) {
    if (!catalog.getByKey(runtime.gameKey)) throw new Error(`game-runtime: runtime para jogo não registrado "${runtime.gameKey}"`);
    if (byKey.has(runtime.gameKey)) throw new Error(`game-runtime: runtime duplicado "${runtime.gameKey}"`);
    byKey.set(runtime.gameKey, runtime);
  }
  for (const gameModule of catalog.listAvailable()) {
    if (gameModule.implementation.realtime && !byKey.has(gameModule.definition.key)) {
      throw new Error(`game-runtime: jogo "${gameModule.definition.key}" está disponível mas não tem runtime`);
    }
  }
  const keys = Object.freeze([...byKey.keys()].sort());
  return Object.freeze({
    get: (gameKey) => byKey.get(gameKey) ?? null,
    has: (gameKey) => byKey.has(gameKey),
    list: () => keys.map((key) => byKey.get(key)),
    keys: () => keys,
  });
}
