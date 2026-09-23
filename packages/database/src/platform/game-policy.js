import { DomainError } from "../errors/domain-error.js";

// The questions the platform asks about a persisted gameKey. The list of games
// is the code registry (injected); the database only stores the key.
//   registered   the registry knows the key       -> its history stays readable
//   available    registered AND status AVAILABLE  -> may get new rooms/matches
// A key that is stored but no longer registered fails loudly on operations
// (GAME_UNKNOWN) instead of being guessed at.
export function createGamePolicy(registry) {
  function requireRegistered(gameKey) {
    const gameModule = typeof gameKey === "string" ? registry.getByKey(gameKey) : null;
    if (!gameModule) throw new DomainError("GAME_UNKNOWN");
    return gameModule;
  }
  function requireAvailable(gameKey) {
    const gameModule = requireRegistered(gameKey);
    if (gameModule.definition.status !== "AVAILABLE") throw new DomainError("GAME_UNAVAILABLE");
    return gameModule;
  }
  return Object.freeze({
    requireRegistered,
    requireAvailable,
    isRegistered: (gameKey) => typeof gameKey === "string" && registry.getByKey(gameKey) !== null,
    isAvailable: (gameKey) => registry.getByKey(gameKey)?.definition.status === "AVAILABLE",
  });
}
