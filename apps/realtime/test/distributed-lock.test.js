import { config } from "dotenv";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createClient } from "redis";
import { acquireLock, releaseLock, withLock } from "../src/distributed-lock.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const redis = createClient({ url: process.env.REDIS_URL });
const prefix = `quizarena:test:lock:${Date.now()}`;

beforeAll(() => redis.connect());
afterAll(() => redis.quit());

async function key(name) {
  const value = `${prefix}:${name}`;
  await redis.del(value);
  return value;
}

test("acquires only when absent and releases only by owner", async () => {
  const lockKey = await key("ownership");
  const owner = await acquireLock(redis, lockKey, 1000);
  expect(owner).toMatch(/^[a-f0-9]{64}$/);
  expect(await acquireLock(redis, lockKey, 1000)).toBeNull();
  expect(await releaseLock(redis, lockKey, "wrong-owner")).toBe(false);
  expect(await redis.get(lockKey)).toBe(owner);
  expect(await releaseLock(redis, lockKey, owner)).toBe(true);
  expect(await redis.get(lockKey)).toBeNull();
});

test("old owner cannot release a lock acquired after expiry", async () => {
  const lockKey = await key("reacquire");
  const oldOwner = await acquireLock(redis, lockKey, 40);
  await new Promise((resolve) => setTimeout(resolve, 70));
  const newOwner = await acquireLock(redis, lockKey, 1000);
  expect(newOwner).not.toBeNull();
  expect(await releaseLock(redis, lockKey, oldOwner)).toBe(false);
  expect(await redis.get(lockKey)).toBe(newOwner);
  await releaseLock(redis, lockKey, newOwner);
});

test("expired locks are removed when the owner dies", async () => {
  const lockKey = await key("expiry");
  await acquireLock(redis, lockKey, 40);
  await new Promise((resolve) => setTimeout(resolve, 70));
  expect(await redis.get(lockKey)).toBeNull();
});

test("withLock releases after success and exception", async () => {
  const successKey = await key("success");
  await withLock(redis, successKey, 1000, async () => "done");
  expect(await redis.get(successKey)).toBeNull();
  const failureKey = await key("failure");
  await expect(withLock(redis, failureKey, 1000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await redis.get(failureKey)).toBeNull();
});
