import { createGameRegistry } from "@quizarena/game-registry";
import { quizGame } from "@quizarena/game-quiz";

// Single composition root: every registered game module is listed here once.
// A new game joins the portal by adding its module to this array - nothing
// in the portal itself branches on which game it is.
const registry = createGameRegistry([quizGame]);

// How many cards a discovery section shows once there are more games than
// fit comfortably in a row. Not paginated - just capped.
const SECTION_LIMIT = 6;

export const listGames = registry.list;
export const listAvailableGames = registry.listAvailable;
export const getGameByKey = registry.getByKey;
export const getGameBySlug = registry.getBySlug;

// "Mais jogados": today this is just every available game, because there is
// no real popularity metric yet (see docs/ADR-006). This is the single seam
// to swap in real metrics later - swap the sort here, not in the portal.
export function listMostPlayedGames(limit = SECTION_LIMIT) {
  return registry.listAvailable().slice(0, limit);
}

// "Jogos recentes": modalities by catalog entry date (newest first), not
// matches the current user played. Includes non-AVAILABLE games too, since
// "recently added to the catalog" is true regardless of playability.
export function listRecentGames(limit = SECTION_LIMIT) {
  return [...registry.list()]
    .sort((a, b) => new Date(b.definition.releasedAt).getTime() - new Date(a.definition.releasedAt).getTime())
    .slice(0, limit);
}
