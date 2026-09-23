import { test, expect } from "vitest";
import { createGameRegistry, GAME_STATUS } from "@quizarena/game-registry";
import { quizGame } from "./src/index.js";

test("the Quiz module is available, routes to /jogos/quiz and supports solo play", () => {
  expect(quizGame.definition.key).toBe("quiz");
  expect(quizGame.definition.slug).toBe("quiz");
  expect(quizGame.definition.status).toBe(GAME_STATUS.AVAILABLE);
  expect(quizGame.definition.route).toBe("/jogos/quiz");
  expect(quizGame.capabilities.minPlayers).toBe(1);
  expect(quizGame.capabilities.supportsSolo).toBe(true);
});

test("Quiz capabilities mirror the definition instead of a second hand-written copy", () => {
  expect(quizGame.capabilities).toEqual({
    minPlayers: quizGame.definition.minPlayers,
    maxPlayers: quizGame.definition.maxPlayers,
    supportsSolo: quizGame.definition.supportsSolo,
    supportsPublicRooms: quizGame.definition.supportsPublicRooms,
    supportsPrivateRooms: quizGame.definition.supportsPrivateRooms,
  });
});

test("the Quiz module registers cleanly on its own", () => {
  const registry = createGameRegistry([quizGame]);
  expect(registry.listAvailable()).toHaveLength(1);
  expect(registry.getByKey("quiz")).toBe(registry.getBySlug("quiz"));
});
