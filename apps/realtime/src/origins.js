// Turns the WEB_ORIGIN setting into a list of individual, trimmed origins.
// It accepts a comma-separated string (the env var) or an array, drops empty
// entries (trailing commas, stray spaces) and never widens the policy: a
// wildcard entry is discarded rather than honored, because credentialed
// requests must name their origins explicitly.
export function parseWebOrigins(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0 && entry !== "*");
}
