import { afterEach, test, expect } from "vitest";
import { io as createClient } from "socket.io-client";
import { EVENTS, systemPongSchema } from "@quizarena/contracts";
import { createRealtimeServer } from "../src/server.js";
import { createHealthChecker } from "../src/health.js";

let realtime;
let client;
afterEach(async () => {
  client?.close();
  client = null;
  await realtime?.close();
  realtime = null;
});

async function listen(
  checks = { checkPostgres: () => true, checkRedis: () => true },
) {
  realtime = createRealtimeServer({
    healthChecker: createHealthChecker(checks),
  });
  await new Promise((resolve) =>
    realtime.httpServer.listen(0, "127.0.0.1", resolve),
  );
  return `http://127.0.0.1:${realtime.httpServer.address().port}`;
}
async function connect() {
  client = createClient(await listen(), { reconnection: false });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
  return client;
}
test("GET /health returns 200 with real dependency check interface and CORS", async () => {
  const url = await listen();
  const response = await fetch(url + "/health", {
    headers: { Origin: "http://localhost:3000" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(
    "http://localhost:3000",
  );
  expect(await response.json()).toMatchObject({
    status: "ok",
    service: "realtime",
    dependencies: { redis: "ok", postgres: "ok" },
  });
});
test.each(["redis", "postgres"])(
  "GET /health returns 503 for %s and recovers",
  async (dependency) => {
    let healthy = false;
    const url = await listen({
      checkRedis: () => dependency !== "redis" || healthy,
      checkPostgres: () => dependency !== "postgres" || healthy,
    });
    const response = await fetch(url + "/health");
    expect(response.status).toBe(503);
    expect((await response.json()).dependencies[dependency]).toBe(
      "unavailable",
    );
    healthy = true;
    expect((await fetch(url + "/health")).status).toBe(200);
  },
);
test("system ping emits pong and acknowledges the same identifier and time", async () => {
  await connect();
  const ping = { id: "roundtrip-1", sentAt: new Date().toISOString() };
  const event = new Promise((resolve) =>
    client.once(EVENTS.SYSTEM_PONG, resolve),
  );
  const ack = await client.timeout(2000).emitWithAck(EVENTS.SYSTEM_PING, ping);
  const pong = await event;
  expect(pong).toEqual(ack);
  expect(systemPongSchema.parse(pong)).toMatchObject(ping);
});
test("invalid payload is controlled; connection continues accepting valid pings", async () => {
  await connect();
  expect(
    await client
      .timeout(2000)
      .emitWithAck(EVENTS.SYSTEM_PING, { sentAt: "invalid" }),
  ).toEqual({ error: "invalid_payload" });
  // Non-function ack arguments and absence of ack must not crash the server.
  client.emit(EVENTS.SYSTEM_PING, null, "not-a-function");
  client.emit(EVENTS.SYSTEM_PING, null);
  const pong = await client
    .timeout(2000)
    .emitWithAck(EVENTS.SYSTEM_PING, {
      id: "after-invalid",
      sentAt: new Date().toISOString(),
    });
  expect(pong.id).toBe("after-invalid");
  expect(client.connected).toBe(true);
});
test("close is idempotent and closes dependencies once", async () => {
  let closed = 0;
  realtime = createRealtimeServer({
    healthChecker: async () => ({ status: "ok" }),
    dependencies: {
      close: async () => {
        closed += 1;
      },
    },
  });
  await new Promise((resolve) => realtime.httpServer.listen(0, resolve));
  await Promise.all([realtime.close(), realtime.close()]);
  expect(closed).toBe(1);
  expect(realtime.httpServer.listening).toBe(false);
});
