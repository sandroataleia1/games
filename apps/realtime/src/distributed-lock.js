import { randomBytes } from "node:crypto";

const RELEASE_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

export async function acquireLock(redis, key, ttlMs) {
  const owner = randomBytes(32).toString("hex");
  const acquired = await redis.set(key, owner, { NX: true, PX: ttlMs });
  return acquired === "OK" ? owner : null;
}

export async function releaseLock(redis, key, owner) {
  if (!owner) return false;
  return (await redis.eval(RELEASE_SCRIPT, { keys: [key], arguments: [owner] })) === 1;
}

export async function withLock(redis, key, ttlMs, operation) {
  const owner = await acquireLock(redis, key, ttlMs);
  if (!owner) return { acquired: false };
  try {
    return { acquired: true, value: await operation() };
  } finally {
    await releaseLock(redis, key, owner);
  }
}
