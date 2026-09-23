import { createQuizAuthoring } from "./authoring.js";
import { createQuizContent } from "./quiz-content.js";
import { createQuizRoomConfiguration } from "./room-configuration.js";
import { createQuizMatchState } from "./match-state.js";
import { createQuizMatchService } from "./matches.js";
import { createQuizRealtime } from "./realtime.js";
import { createQuizRuntime } from "./runtime.js";
import { createLegacyCompat } from "./legacy-compat.js";

export { QUIZ_GAME_KEY, createLegacyCompat, legacyCompatFromEnvironment } from "./legacy-compat.js";
export { quizRepository } from "./quizzes-repository.js";
export { auditQuizLegacy } from "./audit.js";
export { seedDevelopment, runSeed, SEED_QUIZ_ID, SEED_ORGANIZER_ID } from "./seed.js";

// Server side of the Quiz module (never imported by the portal). Receives the
// platform primitives; returns the Quiz's services and its runtime, which the
// composition root registers explicitly.
export function createQuizServer({ client, platform, compat = createLegacyCompat(), maxPlayers = 20, resultAdvanceMs = 45000 }) {
  const states = createQuizMatchState({ compat });
  const rooms = createQuizRoomConfiguration({ client, platform, compat });
  const matches = createQuizMatchService({ client, platform, states, maxPlayers });
  const authoring = createQuizAuthoring(client);
  const content = createQuizContent(client);
  const services = { rooms, matches, authoring, content, states, compat };
  const runtime = createQuizRuntime({ rooms, states, realtime: createQuizRealtime({ quiz: services, resultAdvanceMs }) });
  return { ...services, runtime };
}
