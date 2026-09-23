import { test, expect } from "vitest";
import { listGames, listAvailableGames, getGameByKey, getGameBySlug } from "./game-catalog.js";

test("the portal's catalog exposes only the Quiz module, not the quizzes it plays", () => {
  const games = listGames();
  expect(games).toHaveLength(1);
  expect(games[0].definition.key).toBe("quiz");
  // Content like "Países" or "Frutas" is a Quiz *quiz*, never a platform game.
  const names = games.map((module) => module.definition.name.toLowerCase());
  expect(names).not.toContain("países");
  expect(names).not.toContain("frutas");
  expect(names).not.toContain("futebol");
});

test("listAvailableGames returns the same available modules the homepage renders", () => {
  const available = listAvailableGames();
  expect(available).toHaveLength(1);
  expect(available[0].definition.route).toBe("/jogos/quiz");
  expect(available[0].definition.status).toBe("AVAILABLE");
});

test("getGameByKey and getGameBySlug resolve the Quiz module and reject unknown identifiers", () => {
  expect(getGameByKey("quiz").definition.slug).toBe("quiz");
  expect(getGameBySlug("quiz").definition.key).toBe("quiz");
  expect(getGameByKey("truco")).toBeNull();
  expect(getGameBySlug("nao-existe")).toBeNull();
});
