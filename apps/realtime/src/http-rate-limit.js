import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "redis";
import { DomainError } from "@quizarena/database";

const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export function normalizeIp(value = "") {
  let ip = String(value).trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return isIP(ip) ? ip : "unknown";
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function rateLimitKey(namespace, scope, identity) {
  return `${namespace}:${scope}:${hash(identity)}`;
}

export function createHttpRateLimiter({
  redisUrl,
  client,
  limit = 10,
  windowMs = 60_000,
  namespace = "quizarena:http:rate-limit",
  logger = console,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1)
    throw new Error("Configuração inválida do rate limit HTTP.");
  const redis = client ?? createClient({ url: redisUrl, disableOfflineQueue: true });
  redis.on?.("error", () => logger.error("[rate-limit] Redis indisponível."));
  let connection;
  return {
    async connect() {
      if (!redis.isOpen) connection ??= redis.connect();
      await connection;
    },
    async consume(scope, identity) {
      try {
        if (!redis.isReady) throw new Error("Redis indisponível");
        const [count, ttl] = await redis.eval(SCRIPT, {
          keys: [rateLimitKey(namespace, scope, identity)],
          arguments: [String(windowMs)],
        });
        if (Number(count) > limit)
          throw new DomainError("RATE_LIMITED", "RATE_LIMITED", { retryAfter: Math.max(1, Math.ceil(Number(ttl) / 1000)) });
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError("COORDINATION_UNAVAILABLE");
      }
    },
    async close() {
      if (redis.isOpen) await redis.quit().catch(() => redis.destroy());
    },
  };
}
