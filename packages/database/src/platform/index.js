import { createServerAdapterRegistry } from "@quizarena/game-registry";
import { createGamePolicy } from "./game-policy.js";
import { createPlatformRooms } from "./rooms.js";
import { createPlatformParticipants } from "./participants.js";
import { createPlatformMatches } from "./matches.js";

// The generic platform layer: rooms, matches and participants, driven by the
// game registry and the registered server adapters (both injected).
export function createPlatform({ client, registry, adapters }) {
  const adapterRegistry = createServerAdapterRegistry({ registry, adapters });
  const policy = createGamePolicy(registry);
  const rooms = createPlatformRooms(client, policy);
  const participants = createPlatformParticipants();
  const matches = createPlatformMatches({ client, policy, adapters: adapterRegistry, rooms, participants });
  return Object.freeze({ policy, rooms, participants, matches, adapters: adapterRegistry });
}
