import { gameDefinitionSchema, gameModuleSchema } from "./schema.js";

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
export function createGameRegistry(modules) {
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
  const ordered = Object.freeze([...parsed].sort((a, b) => a.definition.name.localeCompare(b.definition.name, "pt-BR")));

  return Object.freeze({
    list: () => ordered,
    listAvailable: () => ordered.filter((module) => module.definition.status === "AVAILABLE"),
    getByKey: (key) => byKey.get(key) ?? null,
    getBySlug: (slug) => bySlug.get(slug) ?? null,
  });
}
