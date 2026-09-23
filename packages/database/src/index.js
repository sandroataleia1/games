import { gameRegistry } from "@quizarena/game-catalog";
import { createClient } from "./client.js";
import { createQuizService } from "./services/quizzes.js";
import { createSessionService } from "./services/sessions.js";
import { createOrganizerService } from "./services/organizers.js";
import { createRoomService } from "./services/rooms.js";
import { createPlatform } from "./platform/index.js";
import { quizServerAdapter } from "./games/quiz-adapter.js";

export { DomainError } from "./errors/domain-error.js";
export { createDatabaseHealthProbe } from "./client.js";
export { createPlatform } from "./platform/index.js";

// `registry` and `adapters` default to the shared catalog and the Quiz adapter
// (the composition root); tests inject synthetic ones.
export function createDatabase({ databaseUrl, maxPlayers = 20, registry = gameRegistry, adapters = [quizServerAdapter] } = {}) {
  const client = createClient(databaseUrl);
  const platform = createPlatform({ client, registry, adapters });
  return {
    quizzes: createQuizService(client),
    sessions: createSessionService(client, { maxPlayers }),
    organizers: createOrganizerService(client),
    rooms: createRoomService(client, platform),
    platform,
    close: () => client.$disconnect(),
  };
}
