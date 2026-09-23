import { test, expect } from "vitest";
import { createGameRegistry, defineGameModule, GAME_STATUS, gameDefinitionSchema } from "./src/index.js";

const baseDefinition = {
  key: "quiz",
  slug: "quiz",
  name: "Quiz",
  shortDescription: "Curto",
  description: "Longo",
  status: GAME_STATUS.AVAILABLE,
  route: "/jogos/quiz",
  minPlayers: 1,
  maxPlayers: 100,
  supportsSolo: true,
  supportsPublicRooms: true,
  supportsPrivateRooms: false,
  visual: { accent: "var(--lime)", gradient: "linear-gradient(90deg, red, blue)", icon: "Q" },
};

function moduleWith(overrides = {}, definitionOverrides = {}) {
  return defineGameModule({
    definition: { ...baseDefinition, ...definitionOverrides },
    implementation: { web: "apps/web/src/app/jogos/quiz" },
    ...overrides,
  });
}

test("defineGameModule derives capabilities from the definition instead of duplicating them", () => {
  const module = moduleWith();
  expect(module.capabilities).toEqual({
    minPlayers: 1,
    maxPlayers: 100,
    supportsSolo: true,
    supportsPublicRooms: true,
    supportsPrivateRooms: false,
  });
});

test("rejects a definition where supportsSolo disagrees with minPlayers", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, minPlayers: 2, supportsSolo: true })).toThrow();
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, minPlayers: 1, supportsSolo: false })).toThrow();
});

test("rejects a definition where maxPlayers is below minPlayers", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, minPlayers: 5, maxPlayers: 2, supportsSolo: false })).toThrow();
});

test("rejects a definition carrying unknown or secret-shaped fields", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, apiKey: "secret" })).toThrow();
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, handler: () => {} })).toThrow();
});

test("createGameRegistry rejects a duplicate key even with distinct slugs", () => {
  const a = moduleWith({}, { slug: "quiz-a" });
  const b = moduleWith({}, { slug: "quiz-b" });
  expect(() => createGameRegistry([a, b])).toThrow(/chave duplicada/);
});

test("createGameRegistry rejects a duplicate slug even with distinct keys", () => {
  const a = moduleWith({}, { key: "quiz-a" });
  const b = moduleWith({}, { key: "quiz-b" });
  expect(() => createGameRegistry([a, b])).toThrow(/slug duplicado/);
});

test("lists games ordered by name and finds them by key or slug", () => {
  const quiz = moduleWith();
  const truco = moduleWith({}, { key: "truco", slug: "truco", name: "Truco", status: GAME_STATUS.COMING_SOON });
  const registry = createGameRegistry([truco, quiz]);
  expect(registry.list().map((module) => module.definition.key)).toEqual(["quiz", "truco"]);
  expect(registry.getByKey("truco").definition.name).toBe("Truco");
  expect(registry.getBySlug("quiz").definition.name).toBe("Quiz");
  expect(registry.getByKey("nao-existe")).toBeNull();
  expect(registry.getBySlug("nao-existe")).toBeNull();
});

test("only AVAILABLE games can be started: listAvailable excludes COMING_SOON and DISABLED", () => {
  const quiz = moduleWith();
  const comingSoon = moduleWith({}, { key: "truco", slug: "truco", name: "Truco", status: GAME_STATUS.COMING_SOON });
  const disabled = moduleWith({}, { key: "old-game", slug: "old-game", name: "Antigo", status: GAME_STATUS.DISABLED });
  const registry = createGameRegistry([quiz, comingSoon, disabled]);
  const available = registry.listAvailable();
  expect(available).toHaveLength(1);
  expect(available[0].definition.key).toBe("quiz");
});

test("the registry is immutable: list, an entry and its capabilities cannot be mutated", () => {
  const registry = createGameRegistry([moduleWith()]);
  const list = registry.list();
  expect(() => { list.push(moduleWith({}, { key: "extra", slug: "extra" })); }).toThrow();
  expect(() => { list[0].definition.name = "Hackeado"; }).toThrow();
  expect(() => { list[0].capabilities.maxPlayers = 999999; }).toThrow();
});

test("a public definition never carries a handler, a server path or other non-presentational data", () => {
  const module = moduleWith();
  for (const key of Object.keys(module.definition)) {
    expect(typeof module.definition[key]).not.toBe("function");
  }
  expect(module.definition).not.toHaveProperty("secret");
  expect(module.definition).not.toHaveProperty("handlers");
  expect(module.definition).not.toHaveProperty("hostTokenHash");
});
