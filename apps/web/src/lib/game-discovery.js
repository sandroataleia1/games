// Pure selection rules behind "Mais jogados" and "Jogos recentes". Kept
// separate from game-catalog.js (which binds these to the real registry
// singleton) so tests can exercise the rules with synthetic modules
// instead of registering fake games in the application. See docs/ADR-007.

function isValidMetric(metric, getByKey) {
  if (!metric || typeof metric.gameKey !== "string" || metric.gameKey.length === 0) return false;
  const { matchesPlayed } = metric;
  if (typeof matchesPlayed !== "number" || !Number.isFinite(matchesPlayed)) return false;
  if (!Number.isInteger(matchesPlayed) || matchesPlayed < 0) return false;
  const gameModule = getByKey(metric.gameKey);
  return Boolean(gameModule) && gameModule.definition.status === "AVAILABLE";
}

// Without trustworthy metrics this can only honestly single out a game when
// there is exactly one AVAILABLE game to begin with (it's the only
// candidate, not an editorial guess). With two or more available games and
// no metrics, it returns empty - the caller (GameSection) already omits an
// empty section entirely, so nothing renders rather than faking a rank.
export function selectMostPlayedGames({ availableGames, metrics = [], getByKey, limit }) {
  const validMetrics = metrics.filter((metric) => isValidMetric(metric, getByKey));
  if (validMetrics.length === 0) {
    return availableGames.length === 1 ? availableGames.slice(0, limit) : [];
  }
  const countByKey = new Map(validMetrics.map((metric) => [metric.gameKey, metric.matchesPlayed]));
  return [...countByKey.entries()]
    .sort(([keyA, countA], [keyB, countB]) => countB - countA || keyA.localeCompare(keyB))
    .slice(0, limit)
    .map(([key]) => getByKey(key));
}

// DISABLED is excluded here - it is only ever surfaced, discouraged, on the
// full /jogos catalog, never on the home. COMING_SOON is allowed: it is
// real news about the catalog even though it isn't playable yet.
export function selectRecentGames({ games, limit }) {
  return [...games]
    .filter((gameModule) => gameModule.definition.status !== "DISABLED")
    .sort((a, b) => new Date(b.definition.releasedAt).getTime() - new Date(a.definition.releasedAt).getTime())
    .slice(0, limit);
}
