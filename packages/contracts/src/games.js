import { z } from "zod";

export const GAME_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  COMING_SOON: "COMING_SOON",
  DISABLED: "DISABLED",
});

export const gameSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    shortDescription: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(Object.values(GAME_STATUS)),
    route: z.string().startsWith("/"),
    icon: z.string().min(1),
  })
  .strict();

const GAMES = Object.freeze([
  Object.freeze({
    id: "quiz",
    slug: "quiz",
    name: "Quiz",
    shortDescription: "Perguntas e respostas em tempo real, na TV e no celular.",
    description:
      "As salas já existem, sempre abertas. Entre em uma, escolha o tema entre os quizzes publicados e " +
      "qualquer pessoa na sala pode iniciar a partida. Cada rodada tem uma pergunta, um tempo limite e " +
      "pontuação por velocidade de resposta; a partida pode começar com um único participante.",
    status: GAME_STATUS.AVAILABLE,
    route: "/jogos/quiz",
    icon: "Q",
  }),
]);

GAMES.forEach((game) => gameSchema.parse(game));

export function listGames() {
  return GAMES;
}

export function listAvailableGames() {
  return GAMES.filter((game) => game.status === GAME_STATUS.AVAILABLE);
}

export function getGameBySlug(slug) {
  return GAMES.find((game) => game.slug === slug) ?? null;
}
