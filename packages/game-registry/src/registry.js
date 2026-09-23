import { gameCategorySchema, gameDefinitionSchema, gameModuleSchema } from "./schema.js";
import { GAME_CATEGORIES } from "./categories.js";

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

// Builds a GameModule from a definition without hand-duplicating the
// capability fields the definition already carries: `capabilities` is a
// derived view of the same data, never a second source of truth.
export function defineGameModule({ definition, implementation }) {
  const parsedDefinition = gameDefinitionSchema.parse(definition);
  const capabilities = {
    minPlayers: parsedDefinition.minPlayers,
    maxPlayers: parsedDefinition.maxPlayers,
    supportsSolo: parsedDefinition.supportsSolo,
    supportsPublicRooms: parsedDefinition.supportsPublicRooms,
    supportsPrivateRooms: parsedDefinition.supportsPrivateRooms,
  };
  const module = gameModuleSchema.parse({ definition: parsedDefinition, capabilities, implementation });
  return freezeDeep(module);
}

// An immutable, validated catalog of game modules. Throws at construction
// time on a duplicate key/slug rather than letting two games silently
// collide later at lookup time.
export function createGameRegistry(modules, categories = GAME_CATEGORIES) {
  const parsed = modules.map((module) => freezeDeep(gameModuleSchema.parse(module)));
  const byKey = new Map();
  const bySlug = new Map();
  for (const module of parsed) {
    const { key, slug } = module.definition;
    if (byKey.has(key)) throw new Error(`game-registry: chave duplicada "${key}"`);
    if (bySlug.has(slug)) throw new Error(`game-registry: slug duplicado "${slug}"`);
    byKey.set(key, module);
    bySlug.set(slug, module);
  }
  const parsedCategories = categories.map((category) => freezeDeep(gameCategorySchema.parse(category)));
  const categoryByKey = new Map();
  const categoryBySlug = new Map();
  for (const category of parsedCategories) {
    if (categoryByKey.has(category.key)) throw new Error(`game-registry: categoria duplicada "${category.key}"`);
    if (categoryBySlug.has(category.slug)) throw new Error(`game-registry: slug de categoria duplicado "${category.slug}"`);
    categoryByKey.set(category.key, category);
    categoryBySlug.set(category.slug, category);
  }
  for (const module of parsed) {
    for (const categoryKey of module.definition.categoryKeys) {
      if (!categoryByKey.has(categoryKey)) throw new Error(`game-registry: jogo "${module.definition.key}" referencia categoria inexistente "${categoryKey}"`);
    }
  }
  const orderedCategories = Object.freeze([...parsedCategories].sort((a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key)));
  const ordered = Object.freeze([...parsed].sort((a, b) => a.definition.name.localeCompare(b.definition.name, "pt-BR")));

  return Object.freeze({
    list: () => ordered,
    listAvailable: () => ordered.filter((module) => module.definition.status === "AVAILABLE"),
    getByKey: (key) => byKey.get(key) ?? null,
    getBySlug: (slug) => bySlug.get(slug) ?? null,
    listCategories: () => orderedCategories,
    getCategoryByKey: (key) => categoryByKey.get(key) ?? null,
    getCategoryBySlug: (slug) => categoryBySlug.get(slug) ?? null,
    listGamesByCategory: (key) => ordered.filter((module) => module.definition.categoryKeys.includes(key)),
    // Public = has at least one game that isn't DISABLED (AVAILABLE or
    // COMING_SOON are both announced). Plain-data DTOs, no functions.
    listPublicCategories: () => orderedCategories
      .filter((category) => ordered.some((module) => module.definition.status !== "DISABLED" && module.definition.categoryKeys.includes(category.key)))
      .map(({ key, slug, name, description, displayOrder }) => ({ key, slug, name, ...(description ? { description } : {}), displayOrder })),
  });
}
