import { gameCategorySchema } from "./schema.js";

// The one authoritative list of categories today (code, not a database
// table - see docs/ADR-007). Only categories that a registered game really
// uses belong here: no empty placeholders for future genres. CARDS, for
// example, is added together with the module that needs it.
export const GAME_CATEGORIES = Object.freeze(
  [
    { key: "TRIVIA", slug: "trivia", name: "Quiz e conhecimentos", displayOrder: 10 },
  ].map((category) => Object.freeze(gameCategorySchema.parse(category))),
);
