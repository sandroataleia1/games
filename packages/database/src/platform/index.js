import { createGamePolicy } from "./game-policy.js";
import { createPlatformRooms } from "./rooms.js";
import { createPlatformParticipants } from "./participants.js";
import { createPlatformMatches } from "./matches.js";

// The generic platform layer: rooms, matches and participants. `catalog` is the
// public game registry and `runtimes` the server runtime registry; both are
// built and validated by the composition root, and this package never imports a
// game.
export function createPlatform({ client, catalog, runtimes }) {
  const policy = createGamePolicy(catalog);
  const rooms = createPlatformRooms(client, policy);
  const participants = createPlatformParticipants();
  const matches = createPlatformMatches({ client, policy, runtimes, rooms, participants });
  return Object.freeze({ policy, rooms, participants, matches, runtimes });
}
