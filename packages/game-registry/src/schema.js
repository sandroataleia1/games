import { z } from "zod";

export const GAME_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  COMING_SOON: "COMING_SOON",
  DISABLED: "DISABLED",
});

const slugPattern = /^[a-z0-9-]+$/;
const categoryKeyPattern = /^[A-Z][A-Z0-9_]*$/;
const keyPattern = /^[a-z][a-z0-9-]*$/;

// A genre/family of games (TRIVIA, CARDS, ...), shared by every game that
// declares its key. Public data only.
export const gameCategorySchema = z
  .object({
    key: z.string().regex(categoryKeyPattern, "key deve ser MAIÚSCULA_COM_UNDERSCORE"),
    slug: z.string().regex(slugPattern, "slug deve ser kebab-case"),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    displayOrder: z.number().int().nonnegative(),
  })
  .strict();

// Public, presentational metadata for one game. Nothing here may carry a
// secret, a handler, a server path or anything else a client shouldn't see -
// this schema is the DTO, not an internal descriptor.
export const gameDefinitionSchema = z
  .object({
    key: z.string().regex(keyPattern, "key deve ser kebab-case"),
    slug: z.string().regex(slugPattern, "slug deve ser kebab-case"),
    name: z.string().min(1),
    shortDescription: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(Object.values(GAME_STATUS)),
    route: z.string().startsWith("/"),
    // The date this modality entered the MultyGames catalog - not a build
    // timestamp, not "now", and never defaulted. Drives "Jogos recentes".
    releasedAt: z.string().datetime({ offset: true }),
    // Genres/families this game belongs to, by stable key only - the name
    // and description live once, in the category definition. Never
    // capabilities (solo, multiplayer, rooms) and never status.
    categoryKeys: z.array(z.string().regex(categoryKeyPattern, "categoryKey inválida")).min(1, "todo jogo precisa de ao menos uma categoria"),
    minPlayers: z.number().int().positive(),
    maxPlayers: z.number().int().positive(),
    supportsSolo: z.boolean(),
    supportsPublicRooms: z.boolean(),
    supportsPrivateRooms: z.boolean(),
    visual: z
      .object({
        accent: z.string().min(1),
        gradient: z.string().min(1),
        background: z.string().min(1).optional(),
        icon: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .refine((definition) => new Set(definition.categoryKeys).size === definition.categoryKeys.length, "categoryKeys não pode repetir categoria")
  .refine((definition) => definition.maxPlayers >= definition.minPlayers, "maxPlayers deve ser >= minPlayers")
  .refine((definition) => definition.supportsSolo === (definition.minPlayers === 1), "supportsSolo deve refletir minPlayers === 1");

// A registered module: the public definition plus a pointer to where its
// real implementation lives. The registry never imports that implementation
// (it would pull server/React code into a shared package) - `implementation`
// is documentary, resolved by whoever wires the module into the app.
export const gameModuleSchema = z
  .object({
    definition: gameDefinitionSchema,
    capabilities: z
      .object({
        minPlayers: z.number().int().positive(),
        maxPlayers: z.number().int().positive(),
        supportsSolo: z.boolean(),
        supportsPublicRooms: z.boolean(),
        supportsPrivateRooms: z.boolean(),
      })
      .strict(),
    implementation: z
      .object({
        web: z.string().min(1),
        realtime: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();
