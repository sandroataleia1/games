import { createClient } from "./client.js";
import { createQuizService } from "./services/quizzes.js";
import { createSessionService } from "./services/sessions.js";

export { DomainError } from "./errors/domain-error.js";
export { createDatabaseHealthProbe } from "./client.js";
export function createDatabase({ databaseUrl, maxPlayers = 20 } = {}) {
  const client = createClient(databaseUrl);
  return {
    quizzes: createQuizService(client),
    sessions: createSessionService(client, { maxPlayers }),
    close: () => client.$disconnect(),
  };
}
