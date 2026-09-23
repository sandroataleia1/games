import { test, expect } from "vitest";
import { selectMostPlayedGames, selectRecentGames } from "./game-discovery.js";

// Synthetic modules only - never registered in the real app catalog.
function fakeModule(key, status, releasedAt = "2026-01-01T00:00:00.000Z") {
  return { definition: { key, slug: key, name: key, status, releasedAt, route: `/jogos/${key}` }, capabilities: {} };
}
function registryOf(modules) {
  const byKey = new Map(modules.map((module) => [module.definition.key, module]));
  return { getByKey: (key) => byKey.get(key) ?? null };
}

// --- Popularidade -----------------------------------------------------

test("a single AVAILABLE game with no metrics appears (it is trivially the only candidate)", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const result = selectMostPlayedGames({ availableGames: [quiz], metrics: [], getByKey: registryOf([quiz]).getByKey, limit: 6 });
  expect(result).toEqual([quiz]);
});

test("two AVAILABLE games with no metrics return an empty list, not an editorial guess", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const truco = fakeModule("truco", "AVAILABLE");
  const result = selectMostPlayedGames({ availableGames: [quiz, truco], metrics: [], getByKey: registryOf([quiz, truco]).getByKey, limit: 6 });
  expect(result).toEqual([]);
});

test("real metrics determine the order", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const truco = fakeModule("truco", "AVAILABLE");
  const domino = fakeModule("domino", "AVAILABLE");
  const registry = registryOf([quiz, truco, domino]);
  const result = selectMostPlayedGames({
    availableGames: [quiz, truco, domino],
    metrics: [{ gameKey: "quiz", matchesPlayed: 5 }, { gameKey: "truco", matchesPlayed: 10 }, { gameKey: "domino", matchesPlayed: 1 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result.map((module) => module.definition.key)).toEqual(["truco", "quiz", "domino"]);
});

test("a tie in matchesPlayed breaks deterministically by key", () => {
  const b = fakeModule("b-game", "AVAILABLE");
  const a = fakeModule("a-game", "AVAILABLE");
  const registry = registryOf([a, b]);
  const result = selectMostPlayedGames({
    availableGames: [a, b],
    metrics: [{ gameKey: "b-game", matchesPlayed: 5 }, { gameKey: "a-game", matchesPlayed: 5 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result.map((module) => module.definition.key)).toEqual(["a-game", "b-game"]);
});

test("an unknown game key in the metrics is ignored, not crashed on or ranked", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const registry = registryOf([quiz]);
  const result = selectMostPlayedGames({
    availableGames: [quiz],
    metrics: [{ gameKey: "does-not-exist", matchesPlayed: 999 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  // No valid metric survives, so this falls back to the single-game rule.
  expect(result).toEqual([quiz]);
});

test("a COMING_SOON game with a metric never appears in Mais jogados", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const truco = fakeModule("truco", "COMING_SOON");
  const registry = registryOf([quiz, truco]);
  const result = selectMostPlayedGames({
    availableGames: [quiz],
    metrics: [{ gameKey: "truco", matchesPlayed: 999 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result.map((module) => module.definition.key)).toEqual(["quiz"]);
  expect(result.some((module) => module.definition.key === "truco")).toBe(false);
});

test("a DISABLED game with a metric never appears in Mais jogados", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const old = fakeModule("old-game", "DISABLED");
  const registry = registryOf([quiz, old]);
  const result = selectMostPlayedGames({
    availableGames: [quiz],
    metrics: [{ gameKey: "old-game", matchesPlayed: 999 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result.some((module) => module.definition.key === "old-game")).toBe(false);
});

test("rejects a negative matchesPlayed", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const truco = fakeModule("truco", "AVAILABLE");
  const registry = registryOf([quiz, truco]);
  const result = selectMostPlayedGames({
    availableGames: [quiz, truco],
    metrics: [{ gameKey: "quiz", matchesPlayed: -1 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result).toEqual([]);
});

test("rejects a non-integer matchesPlayed", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const truco = fakeModule("truco", "AVAILABLE");
  const registry = registryOf([quiz, truco]);
  const result = selectMostPlayedGames({
    availableGames: [quiz, truco],
    metrics: [{ gameKey: "quiz", matchesPlayed: 4.5 }],
    getByKey: registry.getByKey,
    limit: 6,
  });
  expect(result).toEqual([]);
});

test("rejects NaN and Infinity", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const registry = registryOf([quiz]);
  const withNaN = selectMostPlayedGames({ availableGames: [quiz], metrics: [{ gameKey: "quiz", matchesPlayed: NaN }], getByKey: registry.getByKey, limit: 6 });
  const withInfinity = selectMostPlayedGames({ availableGames: [quiz], metrics: [{ gameKey: "quiz", matchesPlayed: Infinity }], getByKey: registry.getByKey, limit: 6 });
  // Both invalid metrics are dropped; single-AVAILABLE-game fallback applies.
  expect(withNaN).toEqual([quiz]);
  expect(withInfinity).toEqual([quiz]);
});

test("respects the limit", () => {
  const modules = ["a", "b", "c"].map((key) => fakeModule(key, "AVAILABLE"));
  const registry = registryOf(modules);
  const result = selectMostPlayedGames({
    availableGames: modules,
    metrics: modules.map((module, index) => ({ gameKey: module.definition.key, matchesPlayed: 10 - index })),
    getByKey: registry.getByKey,
    limit: 2,
  });
  expect(result).toHaveLength(2);
});

test("never attaches a dynamic metric field onto the game definition it returns", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const result = selectMostPlayedGames({ availableGames: [quiz], metrics: [], getByKey: registryOf([quiz]).getByKey, limit: 6 });
  expect(result[0]).toBe(quiz);
  expect(result[0].definition).not.toHaveProperty("matchesPlayed");
  expect(result[0].definition).not.toHaveProperty("popularityScore");
});

// --- Recentes -----------------------------------------------------------

test("recent games are ordered by releasedAt, newest first", () => {
  const older = fakeModule("older", "AVAILABLE", "2026-01-01T00:00:00.000Z");
  const newer = fakeModule("newer", "AVAILABLE", "2026-06-01T00:00:00.000Z");
  const result = selectRecentGames({ games: [older, newer], limit: 6 });
  expect(result.map((module) => module.definition.key)).toEqual(["newer", "older"]);
});

test("AVAILABLE appears in Jogos recentes", () => {
  const quiz = fakeModule("quiz", "AVAILABLE");
  const result = selectRecentGames({ games: [quiz], limit: 6 });
  expect(result).toEqual([quiz]);
});

test("COMING_SOON appears in Jogos recentes (it is real catalog news, just not playable yet)", () => {
  const truco = fakeModule("truco", "COMING_SOON");
  const result = selectRecentGames({ games: [truco], limit: 6 });
  expect(result).toEqual([truco]);
});

test("DISABLED never appears in Jogos recentes", () => {
  const old = fakeModule("old-game", "DISABLED");
  const quiz = fakeModule("quiz", "AVAILABLE");
  const result = selectRecentGames({ games: [old, quiz], limit: 6 });
  expect(result.some((module) => module.definition.key === "old-game")).toBe(false);
});

test("respects the limit", () => {
  const modules = ["a", "b", "c"].map((key) => fakeModule(key, "AVAILABLE"));
  const result = selectRecentGames({ games: modules, limit: 1 });
  expect(result).toHaveLength(1);
});
