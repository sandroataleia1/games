// The single decision point for what a GameCard renders, given a game's
// status and the card's variant. Pulled out of the component so the "never
// offer a start action for a non-AVAILABLE game, in any variant" rule has a
// plain, DOM-free unit test - GameCard.js just renders whatever this
// returns, it never re-derives `playable` itself.
export const STATUS_LABEL = Object.freeze({ AVAILABLE: "Disponível", COMING_SOON: "Em breve", DISABLED: "Indisponível" });

export function resolveCardState(definition, variant) {
  const playable = definition.status === "AVAILABLE";
  return {
    playable,
    // The badge stays hidden in the compact variant only while AVAILABLE
    // (the common case, kept visually light); anything else - in any
    // variant - must be unambiguous.
    showBadge: variant === "catalog" || !playable,
    statusLabel: STATUS_LABEL[definition.status] ?? definition.status,
  };
}

// Category names shown as tags on a card. Only the catalog variant shows
// them (the home sections stay light); names always come from the shared
// category definitions via `getCategoryByKey`, never from the game itself,
// and nothing here branches on which game it is.
export function resolveCategoryTags(definition, variant, getCategoryByKey) {
  if (variant !== "catalog") return [];
  return definition.categoryKeys.map((key) => getCategoryByKey(key)).filter(Boolean).map(({ key, slug, name }) => ({ key, slug, name }));
}
