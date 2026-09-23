import { gameRegistry as registry } from "@quizarena/game-catalog";
import { selectMostPlayedGames, selectRecentGames } from "./game-discovery.js";

// The registry is composed once, in @quizarena/game-catalog, and shared with
// the platform services - the portal never keeps its own list of games.

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
