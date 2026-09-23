import { createGameRegistry } from "@quizarena/game-registry";
import { quizGame } from "@quizarena/game-quiz";

// Single composition root: every registered game module is listed here once.
// A new game joins the portal by adding its module to this array - nothing
// in the portal itself branches on which game it is.
const registry = createGameRegistry([quizGame]);

export const listGames = registry.list;
export const listAvailableGames = registry.listAvailable;
export const getGameByKey = registry.getByKey;
export const getGameBySlug = registry.getBySlug;
