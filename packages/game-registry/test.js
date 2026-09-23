import { test, expect } from "vitest";
import { createGameRegistry, defineGameModule, defineGameServerAdapter, createServerAdapterRegistry, SERVER_ADAPTER_METHODS, GAME_STATUS, GAME_CATEGORIES, gameCategorySchema, gameDefinitionSchema } from "./src/index.js";

const baseDefinition = {
  key: "quiz",
  slug: "quiz",
  name: "Quiz",
  shortDescription: "Curto",
  description: "Longo",
  status: GAME_STATUS.AVAILABLE,
  route: "/jogos/quiz",
  releasedAt: "2026-09-23T08:22:12-03:00",
  categoryKeys: ["TRIVIA"],
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

test("rejects a definition with a non-ISO releasedAt, never defaults it to now", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, releasedAt: "23/09/2026" })).toThrow();
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, releasedAt: undefined })).toThrow();
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

// --- Categorias (sintéticas; nunca registradas na aplicação) --------------

const trivia = { key: "TRIVIA", slug: "trivia", name: "Quiz e conhecimentos", displayOrder: 10 };
const cards = { key: "CARDS", slug: "cards", name: "Cartas", displayOrder: 20 };
const puzzle = { key: "PUZZLE", slug: "puzzle", name: "Quebra-cabeças", displayOrder: 5 };

test("only TRIVIA is registered in the real category list - no empty future categories", () => {
  expect(GAME_CATEGORIES.map((category) => category.key)).toEqual(["TRIVIA"]);
  expect(GAME_CATEGORIES[0]).toMatchObject({ slug: "trivia", name: "Quiz e conhecimentos" });
});

test("category keys and slugs must be unique", () => {
  expect(() => createGameRegistry([moduleWith()], [trivia, { ...cards, key: "TRIVIA" }])).toThrow(/categoria duplicada/);
  expect(() => createGameRegistry([moduleWith()], [trivia, { ...cards, slug: "trivia" }])).toThrow(/slug de categoria duplicado/);
});

test("categories are listed in a deterministic displayOrder, then key", () => {
  const registry = createGameRegistry([moduleWith()], [cards, trivia, puzzle, { ...cards, key: "ARCADE", slug: "arcade", displayOrder: 20 }]);
  expect(registry.listCategories().map((category) => category.key)).toEqual(["PUZZLE", "TRIVIA", "ARCADE", "CARDS"]);
});

test("the category list and its entries are immutable", () => {
  const registry = createGameRegistry([moduleWith()], [trivia]);
  expect(() => { registry.listCategories().push(cards); }).toThrow();
  expect(() => { registry.listCategories()[0].name = "Hackeada"; }).toThrow();
});

test("categories are found by key and by slug", () => {
  const registry = createGameRegistry([moduleWith()], [trivia, cards]);
  expect(registry.getCategoryByKey("CARDS").slug).toBe("cards");
  expect(registry.getCategoryBySlug("trivia").key).toBe("TRIVIA");
  expect(registry.getCategoryByKey("NOPE")).toBeNull();
  expect(registry.getCategoryBySlug("nope")).toBeNull();
});

test("a game must declare at least one category", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, categoryKeys: [] })).toThrow();
  const withoutCategories = { ...baseDefinition };
  delete withoutCategories.categoryKeys;
  expect(() => gameDefinitionSchema.parse(withoutCategories)).toThrow();
});

test("a game cannot repeat a category", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, categoryKeys: ["TRIVIA", "TRIVIA"] })).toThrow();
});

test("free text and capability-like words are not valid category keys", () => {
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, categoryKeys: ["modo solo"] })).toThrow();
  expect(() => gameDefinitionSchema.parse({ ...baseDefinition, categoryKeys: ["trivia"] })).toThrow();
});

test("referencing a category that does not exist fails at registry initialization", () => {
  expect(() => createGameRegistry([moduleWith({}, { categoryKeys: ["GHOST"] })], [trivia])).toThrow(/categoria inexistente "GHOST"/);
});

test("a game may belong to several categories, and a category to several games (many-to-many)", () => {
  const a = moduleWith({}, { key: "a-game", slug: "a-game", name: "A", categoryKeys: ["TRIVIA", "CARDS"] });
  const b = moduleWith({}, { key: "b-game", slug: "b-game", name: "B", categoryKeys: ["CARDS"] });
  const registry = createGameRegistry([a, b], [trivia, cards]);
  expect(registry.listGamesByCategory("CARDS").map((m) => m.definition.key)).toEqual(["a-game", "b-game"]);
  expect(registry.listGamesByCategory("TRIVIA").map((m) => m.definition.key)).toEqual(["a-game"]);
  expect(registry.listGamesByCategory("PUZZLE")).toEqual([]);
});

test("public categories only include those with a publicly visible game, as plain DTOs", () => {
  const live = moduleWith({}, { key: "live", slug: "live", name: "Live", categoryKeys: ["TRIVIA"] });
  const soon = moduleWith({}, { key: "soon", slug: "soon", name: "Soon", status: GAME_STATUS.COMING_SOON, categoryKeys: ["CARDS"] });
  const off = moduleWith({}, { key: "off", slug: "off", name: "Off", status: GAME_STATUS.DISABLED, categoryKeys: ["PUZZLE"] });
  const registry = createGameRegistry([live, soon, off], [trivia, cards, puzzle]);
  const publicCategories = registry.listPublicCategories();
  expect(publicCategories.map((category) => category.key)).toEqual(["TRIVIA", "CARDS"]);
  for (const category of publicCategories) {
    expect(Object.values(category).some((value) => typeof value === "function")).toBe(false);
  }
});

test("category definitions reject unknown fields and non-integer order", () => {
  expect(() => gameCategorySchema.parse({ ...trivia, secret: 1 })).toThrow();
  expect(() => gameCategorySchema.parse({ ...trivia, displayOrder: 1.5 })).toThrow();
});

test("card artwork must be an internal path, never an external URL", () => {
  const visual = (art) => ({ ...baseDefinition, visual: { ...baseDefinition.visual, art } });
  expect(gameDefinitionSchema.parse(visual("/assets/x.png")).visual.art).toBe("/assets/x.png");
  expect(() => gameDefinitionSchema.parse(visual("https://evil.test/x.png"))).toThrow();
  expect(() => gameDefinitionSchema.parse(visual("//evil.test/x.png"))).toThrow();
});

// --- Server adapters (PLATFORM-07B) -----------------------------------------

const withRealtime = (definitionOverrides = {}) => moduleWith({ implementation: { web: "apps/web/x", realtime: "apps/realtime/x" } }, definitionOverrides);
const adapterFor = (gameKey, overrides = {}) => ({ gameKey, prepareMatch: async () => ({ columns: {} }), createParticipantState: async () => {}, recoverMatch: () => null, ...overrides });

test("the adapter contract is exactly the methods the platform calls", () => {
  expect(SERVER_ADAPTER_METHODS).toEqual(["prepareMatch", "createParticipantState", "recoverMatch"]);
});

test("an adapter must implement every method and cannot carry extras", () => {
  for (const method of SERVER_ADAPTER_METHODS) expect(() => defineGameServerAdapter(adapterFor("quiz", { [method]: undefined }))).toThrow();
  expect(() => defineGameServerAdapter(adapterFor("quiz", { handleCommand: () => {} }))).toThrow();
  expect(Object.isFrozen(defineGameServerAdapter(adapterFor("quiz")))).toBe(true);
});

test("the adapter registry resolves adapters by gameKey and answers null for a game without one", () => {
  const registry = createGameRegistry([withRealtime()]);
  const adapters = createServerAdapterRegistry({ registry, adapters: [adapterFor("quiz")] });
  expect(adapters.get("quiz").gameKey).toBe("quiz");
  expect(adapters.has("quiz")).toBe(true);
  expect(adapters.get("other")).toBeNull();
});

test("an adapter for a game that is not registered is refused", () => {
  const registry = createGameRegistry([withRealtime()]);
  expect(() => createServerAdapterRegistry({ registry, adapters: [adapterFor("quiz"), adapterFor("ghost")] })).toThrow(/ghost/);
});

test("two adapters for the same game are refused", () => {
  const registry = createGameRegistry([withRealtime()]);
  expect(() => createServerAdapterRegistry({ registry, adapters: [adapterFor("quiz"), adapterFor("quiz")] })).toThrow(/duplicado/);
});

test("an AVAILABLE game with a realtime implementation but no adapter fails at startup", () => {
  const registry = createGameRegistry([withRealtime()]);
  expect(() => createServerAdapterRegistry({ registry, adapters: [] })).toThrow(/quiz/);
});

test("games that are not AVAILABLE, or have no realtime implementation, need no adapter", () => {
  const soon = withRealtime({ key: "soon", slug: "soon", name: "Soon", status: GAME_STATUS.COMING_SOON });
  const webOnly = moduleWith({}, { key: "web-only", slug: "web-only", name: "Web only" });
  const registry = createGameRegistry([soon, webOnly]);
  expect(() => createServerAdapterRegistry({ registry, adapters: [] })).not.toThrow();
});
