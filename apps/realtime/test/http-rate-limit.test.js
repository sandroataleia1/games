import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { createClient } from "redis";
import { createHttpRateLimiter, normalizeIp, rateLimitKey } from "../src/http-rate-limit.js";
import { createRealtimeServer } from "../src/server.js";

const redisUrl = "redis://localhost:56379";
const limiters = [];
const make = (options = {}) => {
  const limiter = createHttpRateLimiter({ redisUrl, namespace: `test:http:${randomUUID()}`, logger: { error() {} }, ...options });
  limiters.push(limiter);
  return limiter;
};
afterEach(async () => Promise.all(limiters.splice(0).map((limiter) => limiter.close())));

test("normalizes proxy addresses and hashes identities in namespaced keys", () => {
  expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  expect(normalizeIp("not-an-ip")).toBe("unknown");
  const key = rateLimitKey("quiz:http", "auth-ip", "203.0.113.8");
  expect(key).toMatch(/^quiz:http:auth-ip:[a-f0-9]{64}$/);
  expect(key).not.toContain("203.0.113.8");
});

test("two instances share an alternating and concurrent atomic budget", async () => {
  const namespace = `test:http:${randomUUID()}`;
  const a = make({ namespace, limit: 6 }), b = make({ namespace, limit: 6 });
  await Promise.all([a.connect(), b.connect()]);
  for (let index = 0; index < 6; index += 1) await (index % 2 ? a : b).consume("auth-ip", "198.51.100.3");
  await expect(a.consume("auth-ip", "198.51.100.3")).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: expect.any(Number) } });
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).consume("auth-email", "same@example.com")));
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(6);
  expect(results.filter(({ status }) => status === "rejected")).toHaveLength(6);
});

test("expires counters and fails closed without Redis", async () => {
  const limiter = make({ limit: 1, windowMs: 80 }); await limiter.connect();
  await limiter.consume("auth-ip", "192.0.2.1");
  await expect(limiter.consume("auth-ip", "192.0.2.1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await expect(limiter.consume("auth-ip", "192.0.2.1")).resolves.toBeUndefined();
  await limiter.close();
  await expect(limiter.consume("auth-ip", "192.0.2.2")).rejects.toMatchObject({ code: "COORDINATION_UNAVAILABLE" });
});

test("Redis never stores raw IP or email", async () => {
  const namespace = `test:http:${randomUUID()}`, limiter = make({ namespace }); await limiter.connect();
  await limiter.consume("auth-email", "private@example.com");
  const client = createClient({ url: redisUrl }); await client.connect();
  const keys = await client.keys(`${namespace}:*`); await client.del(keys); await client.quit();
  expect(keys).toHaveLength(1); expect(keys[0]).not.toContain("private@example.com");
});

test("two HTTP instances enforce one shared limit and return Retry-After", async () => {
  const namespace = `test:http:${randomUUID()}`, servers = [];
  const database = { organizers: { login: async () => ({ token: "token", expiresAt: new Date(Date.now() + 10000), user: { id: "owner" } }) } };
  for (let index = 0; index < 2; index += 1) {
    const rateLimiter = make({ namespace, limit: 4 }); await rateLimiter.connect();
    const server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database, rateLimiter, webOrigin: "http://localhost:3000" });
    await new Promise((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve)); servers.push(server);
  }
  const urls = servers.map((server) => `http://127.0.0.1:${server.httpServer.address().port}/api/auth/login`);
  const send = (index) => fetch(urls[index % 2], { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ email: "shared@example.com", password: "irrelevant" }) });
  const alternating = []; for (let index = 0; index < 5; index += 1) alternating.push(await send(index));
  expect(alternating.slice(0, 4).map(({ status }) => status)).toEqual([200, 200, 200, 200]);
  expect(alternating[4].status).toBe(429); expect(Number(alternating[4].headers.get("retry-after"))).toBeGreaterThan(0);
  await Promise.all(servers.map((server) => server.close()));
});
