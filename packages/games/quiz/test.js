import { test, expect } from "vitest";
import { createGameRegistry, GAME_STATUS } from "@multygames/game-registry";
import { quizGame } from "./src/index.js";

test("the Quiz module is available, routes to /jogos/quiz and supports solo play", () => {
  expect(quizGame.definition.key).toBe("quiz");
  expect(quizGame.definition.slug).toBe("quiz");
  expect(quizGame.definition.status).toBe(GAME_STATUS.AVAILABLE);
  expect(quizGame.definition.route).toBe("/jogos/quiz");
  expect(quizGame.capabilities.minPlayers).toBe(1);
  expect(quizGame.capabilities.supportsSolo).toBe(true);
});

test("the Quiz module carries a real, non-default releasedAt", () => {
  expect(quizGame.definition.releasedAt).toBe("2026-09-23T08:22:12-03:00");
  expect(() => new Date(quizGame.definition.releasedAt).toISOString()).not.toThrow();
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

test("the Quiz belongs to TRIVIA, by key only", () => {
  expect(quizGame.definition.categoryKeys).toEqual(["TRIVIA"]);
  expect(quizGame.definition).not.toHaveProperty("categories");
});
