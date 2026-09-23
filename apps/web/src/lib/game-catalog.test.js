import { test, expect } from "vitest";
import { listGames, listAvailableGames, listMostPlayedGames, listRecentGames, getGameByKey, getGameBySlug } from "./game-catalog.js";

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

test("Mais jogados: with no metrics and a single available game (the real catalog today), it is the only card", () => {
  // Exhaustive ranking/fallback rule coverage (ties, invalid metrics, two
  // available games with no metrics, etc.) lives in game-discovery.test.js
  // against synthetic modules; this just checks the wrapper is wired to the
  // real registry correctly.
  const mostPlayed = listMostPlayedGames([]);
  expect(mostPlayed).toHaveLength(1);
  expect(mostPlayed[0].definition.key).toBe("quiz");
});

test("Mais jogados respects its section limit", () => {
  expect(listMostPlayedGames([], 0)).toHaveLength(0);
});

test("Jogos recentes: sorted newest releasedAt first, and Quiz legitimately appears since it is the only entry", () => {
  const recent = listRecentGames();
  expect(recent).toHaveLength(1);
  expect(recent[0].definition.key).toBe("quiz");
  const timestamps = recent.map((module) => new Date(module.definition.releasedAt).getTime());
  expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
});

test("Jogos recentes respects its section limit", () => {
  expect(listRecentGames(0)).toHaveLength(0);
});
