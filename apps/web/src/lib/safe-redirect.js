const SAFE_PATH = /^\/(?!\/|\\)[^\s\\]*$/;

export function safeInternalPath(candidate, fallback = "/") {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2048) return fallback;
  let value = candidate;
  try {
    value = decodeURI(candidate);
  } catch {
    return fallback;
  }
  if (!SAFE_PATH.test(value)) return fallback;
  if (/^\/{2,}/.test(value) || value.includes("://") || /^[a-z][a-z0-9+.-]*:/i.test(value.slice(1))) return fallback;
  if (/[\x00-\x1f]/.test(value)) return fallback;
  return value;
}

export function withNext(path, next) {
  const safe = safeInternalPath(next, "");
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
