import { createClient, createIdentityService, createPlatform } from "@quizarena/database";
import { gameRegistry } from "@multygames/game-catalog";
import { createGameRuntimeRegistry } from "@multygames/game-runtime";
import { createQuizServer, legacyCompatFromEnvironment } from "@multygames/game-quiz/server";

// COMPOSITION ROOT of the server side. This is the one place that knows which
// games exist and wires them, explicitly:
//   1. load the public catalog (@multygames/game-catalog);
//   2. build the platform (generic rooms/matches/participants) on the database
//      primitives - it never imports a game;
//   3. build each game's server (today: the Quiz) from the platform primitives;
//   4. register their runtimes and validate them against the catalog (unique,
//      defined, none missing for an AVAILABLE game); the registry is immutable
//      afterwards.
// `catalog` and `extraRuntimes` exist so tests can add synthetic games; the
// application never registers anything but the Quiz here.
export function createServerDatabase({ databaseUrl, maxPlayers = 20, resultAdvanceMs = 45000, logger = console, catalog = gameRegistry, extraRuntimes = [], legacyCompat = process.env.LEGACY_QUIZ_COMPAT } = {}) {
  const client = createClient(databaseUrl);
  let registry = null;
  // The platform resolves runtimes lazily so the game servers (which need the
  // platform) can be built first; the registry below is assigned before any use.
  const runtimes = { get: (gameKey) => registry?.get(gameKey) ?? null, has: (gameKey) => registry?.has(gameKey) ?? false };
  const platform = createPlatform({ client, catalog, runtimes });
  const compat = legacyCompatFromEnvironment(legacyCompat, logger);
  const quiz = createQuizServer({ client, platform, compat, maxPlayers, resultAdvanceMs });
  registry = createGameRuntimeRegistry({ catalog, runtimes: [quiz.runtime, ...extraRuntimes] });
  const identity = createIdentityService(client);
  return {
    client,
    catalog,
    platform,
    runtimes: registry,
    identity,
    quiz,
    // Compatibility views used by the realtime app and by tests: the same
    // method names the single database object used to expose.
    organizers: { ...identity, ...quiz.authoring, createOwnedRoom: quiz.matches.createOwnedRoom, createRoomFromPublished: quiz.matches.createRoomFromPublished },
    quizzes: quiz.content,
    sessions: quiz.matches,
    rooms: {
      list: (filter) => platform.rooms.list(filter),
      get: (number) => platform.rooms.get(number),
      getById: (id) => platform.rooms.getById(id),
      selectTheme: (number, quizId) => quiz.rooms.select(number, quizId),
      startMatch: (number, participants) => platform.matches.start(number, participants),
      reopen: async (roomId, matchId) => { await platform.rooms.release(roomId, matchId); return platform.rooms.getById(roomId); },
    },
    close: () => client.$disconnect(),
  };
}
