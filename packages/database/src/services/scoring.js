export function calculatePoints({ basePoints, responseTimeMs, durationMs, isCorrect }) {
  if (!isCorrect) return 0;
  const elapsedRatio = Math.min(1, Math.max(0, responseTimeMs / durationMs));
  const speedBonus = Math.floor(basePoints * (1 - elapsedRatio) * 0.5);
  return basePoints + speedBonus;
}
