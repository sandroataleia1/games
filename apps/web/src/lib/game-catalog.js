import { createGameRegistry } from "@quizarena/game-registry";
import { quizGame } from "@quizarena/game-quiz";
import { selectMostPlayedGames, selectRecentGames } from "./game-discovery.js";

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
export const listCategories = registry.listCategories;
export const listPublicCategories = registry.listPublicCategories;
export const getCategoryByKey = registry.getCategoryByKey;
export const getCategoryBySlug = registry.getCategoryBySlug;
export const listGamesByCategory = registry.listGamesByCategory;

// A GameActivityMetric is { gameKey, matchesPlayed }: the shape PLATFORM-07B
// (or a later stage) must supply once durable per-game metrics exist - see
// docs/ADR-007. Nothing here is persisted; the caller fetches/aggregates
// real counts and passes them in. The ranking rules themselves (including
// the single-game fallback) live in game-discovery.js.
export function listMostPlayedGames(metrics = [], limit = SECTION_LIMIT) {
  return selectMostPlayedGames({ availableGames: registry.listAvailable(), metrics, getByKey: registry.getByKey, limit });
}

// "Jogos recentes": modalities by catalog entry date (newest first), not
// matches the current user played.
export function listRecentGames(limit = SECTION_LIMIT) {
  return selectRecentGames({ games: registry.list(), limit });
}
