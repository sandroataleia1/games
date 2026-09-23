import { createGameRegistry } from "@multygames/game-registry";
import { quizGame } from "@multygames/game-quiz";

// The single composition root of registered games, shared by the portal (web)
// and the platform services (database/realtime). A new game joins by adding
// its module here once; nobody keeps a second list.
export const gameRegistry = createGameRegistry([quizGame]);
