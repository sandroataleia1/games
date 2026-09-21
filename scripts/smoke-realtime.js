import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireRealtime = createRequire(
  new URL("../apps/realtime/package.json", import.meta.url),
);
const { io } = requireRealtime("socket.io-client");
const { EVENTS, systemPongSchema } =
  await import("../packages/contracts/src/index.js");
const url = process.env.REALTIME_URL || "http://localhost:3001";
const response = await fetch(url + "/health");
const health = await response.json();
console.info(JSON.stringify({ httpStatus: response.status, health }));
assert.equal(response.status, 200);
assert.equal(health.dependencies.redis, "ok");
assert.equal(health.dependencies.postgres, "ok");
const socket = io(url, { reconnection: false, timeout: 3000 });
try {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const ping = { id: "smoke-live", sentAt: new Date().toISOString() };
  const event = new Promise((resolve) =>
    socket.once(EVENTS.SYSTEM_PONG, resolve),
  );
  const ack = await socket.timeout(3000).emitWithAck(EVENTS.SYSTEM_PING, ping);
  assert.deepEqual(systemPongSchema.parse(await event), ack);
  assert.equal(ack.id, ping.id);
  assert.equal(ack.sentAt, ping.sentAt);
  assert.deepEqual(
    await socket.timeout(3000).emitWithAck(EVENTS.SYSTEM_PING, {}),
    { error: "invalid_payload" },
  );
  assert.equal(socket.connected, true);
  console.info(
    JSON.stringify({
      socketConnected: true,
      pong: ack,
      invalidPayload: "controlled",
    }),
  );
} finally {
  socket.close();
}
