import { z } from "zod";
import { safeInternalPath } from "./safe-redirect";

// Carousel slides are editorial campaigns for the portal, not game
// definitions - they belong here, not in a game module's metadata
// (docs/ADR-006 explains why marketing content stays out of the game
// registry's core).
const slideSchema = z
  .object({
    id: z.string().min(1),
    eyebrow: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    actionLabel: z.string().min(1),
    actionHref: z.string().min(1),
    visual: z.enum(["platform", "quiz-group", "quiz-solo"]),
    accent: z.string().min(1),
  })
  .strict();

const rawSlides = [
  {
    id: "platform",
    title: "MultyGames",
    description: "Jogos para curtir sozinho ou com a turma.",
    actionLabel: "Explorar jogos",
    actionHref: "/jogos",
    visual: "platform",
    accent: "var(--lime)",
  },
  {
    id: "quiz-group",
    eyebrow: "Quiz",
    title: "Desafie sua turma",
    description: "Crie uma sala, compartilhe o código e descubra quem sabe mais.",
    actionLabel: "Jogar Quiz",
    actionHref: "/jogos/quiz",
    visual: "quiz-group",
    accent: "var(--cyan)",
  },
  {
    id: "quiz-solo",
    eyebrow: "Quiz",
    title: "Prefere jogar sozinho?",
    description: "Escolha um quiz e teste seus conhecimentos no seu ritmo.",
    actionLabel: "Jogar sozinho",
    actionHref: "/jogos/quiz",
    visual: "quiz-solo",
    accent: "var(--violet)",
  },
];

function parseSlides(slides) {
  if (!Array.isArray(slides) || slides.length === 0) throw new Error("portal-slides: é preciso ao menos uma lâmina");
  const parsed = slides.map((slide) => slideSchema.parse(slide));
  const ids = new Set();
  for (const slide of parsed) {
    if (ids.has(slide.id)) throw new Error(`portal-slides: id duplicado "${slide.id}"`);
    ids.add(slide.id);
    if (safeInternalPath(slide.actionHref, "") !== slide.actionHref) {
      throw new Error(`portal-slides: destino inválido ou externo "${slide.actionHref}"`);
    }
  }
  return Object.freeze(parsed.map((slide) => Object.freeze(slide)));
}

export const portalSlides = parseSlides(rawSlides);
