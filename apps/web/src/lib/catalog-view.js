// Pure rules for what /jogos shows for a given ?categoria=<slug>. Kept out
// of the page so filtering happens on the server (no client JS needed) and
// so tests can use synthetic categories instead of registering fake ones.
//
// - Filter controls only exist with two or more public categories; with
//   one, "Todos" + that category would be a redundant bar.
// - An unknown slug never empties the page: it falls back to every game and
//   reports `unknownCategory` so the page can say so.
export function buildCatalogView({ games, publicCategories, getCategoryBySlug, categorySlug }) {
  const filtersVisible = publicCategories.length >= 2;
  const requested = typeof categorySlug === "string" && categorySlug.length > 0 ? categorySlug : null;
  const active = requested ? getCategoryBySlug(requested) : null;
  const unknownCategory = Boolean(requested) && !active;
  const visibleGames = active ? games.filter((gameModule) => gameModule.definition.categoryKeys.includes(active.key)) : games;
  return { filtersVisible, active, unknownCategory, games: visibleGames };
}
