// Presentation-only visual identity per game, keyed by slug. Each future
// game registers its own accent here instead of the homepage assuming
// Quiz's colors. Falls back to the Quiz accent for an unmapped slug so a
// newly registered game never renders unstyled.
const DEFAULT_VISUAL = { from: "var(--lime)", to: "var(--cyan)", ink: "#16221a" };

const VISUALS = {
  quiz: { from: "var(--lime)", to: "var(--cyan)", ink: "#16221a" },
};

export function getGameVisual(slug) {
  return VISUALS[slug] ?? DEFAULT_VISUAL;
}
