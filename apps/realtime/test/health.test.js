import { test, expect } from "vitest";
import { createHealthChecker } from "../src/health.js";

test("healthy dependencies return service and timestamp", async () => {
  const result = await createHealthChecker({
    checkPostgres: () => true,
    checkRedis: () => true,
  })();
  expect(result).toMatchObject({
    status: "ok",
    service: "realtime",
    dependencies: { postgres: "ok", redis: "ok" },
  });
  expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
});
test.each(["postgres", "redis"])("identifies unavailable %s", async (name) => {
  const result = await createHealthChecker({
    checkPostgres: () => {
      if (name === "postgres") throw new Error("offline");
      return true;
    },
    checkRedis: async () => {
      if (name === "redis") throw new Error("offline");
      return true;
    },
  })();
  expect(result.status).toBe("degraded");
  expect(result.dependencies[name]).toBe("unavailable");
});
test("bounds hanging checks and allows later recovery", async () => {
  let available = false;
  const check = createHealthChecker(
    {
      checkPostgres: () => true,
      checkRedis: () => (available ? true : new Promise(() => {})),
    },
    { timeoutMs: 20 },
  );
  expect((await check()).dependencies.redis).toBe("unavailable");
  available = true;
  expect((await check()).status).toBe("ok");
});
