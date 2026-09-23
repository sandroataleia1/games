import http from "node:http";
import { afterEach, test, expect } from "vitest";
import { io as createClient } from "socket.io-client";
import { parseWebOrigins } from "../src/origins.js";
import { createRealtimeServer } from "../src/server.js";

// --- parseWebOrigins -------------------------------------------------------

test("a single origin becomes a one-item list", () => {
  expect(parseWebOrigins("http://localhost:3000")).toEqual(["http://localhost:3000"]);
});

test("two origins are split individually", () => {
  expect(parseWebOrigins("http://localhost:3000,http://192.168.1.10:3000")).toEqual(["http://localhost:3000", "http://192.168.1.10:3000"]);
});

test("spaces around entries are trimmed", () => {
  expect(parseWebOrigins("  http://a.test ,\thttp://b.test  ")).toEqual(["http://a.test", "http://b.test"]);
});

test("empty entries and a trailing comma are dropped", () => {
  expect(parseWebOrigins("http://a.test,, ,http://b.test,")).toEqual(["http://a.test", "http://b.test"]);
});

test("a missing or empty setting yields no origins (nothing is allowed by accident)", () => {
  expect(parseWebOrigins(undefined)).toEqual([]);
  expect(parseWebOrigins("")).toEqual([]);
});

test("a wildcard is never honored, alone or in a list", () => {
  expect(parseWebOrigins("*")).toEqual([]);
  expect(parseWebOrigins("http://a.test,*")).toEqual(["http://a.test"]);
});

test("an already-parsed array is normalized the same way", () => {
  expect(parseWebOrigins([" http://a.test ", ""])).toEqual(["http://a.test"]);
});

// --- real server: which origins are actually allowed ------------------------

let realtime;
let client;
afterEach(async () => {
  client?.close();
  client = null;
  await realtime?.close();
  realtime = null;
});

async function listen(webOrigin) {
  realtime = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), webOrigin });
  await new Promise((resolve) => realtime.httpServer.listen(0, "127.0.0.1", resolve));
  return realtime.httpServer.address().port;
}

function get(port, path, origin) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: origin ? { Origin: origin } : {} }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.headers));
    });
    request.on("error", reject);
    request.end();
  });
}

const LIST = "http://localhost:3000, http://192.168.1.10:3000,";

test("Socket.IO CORS allows each configured origin individually, echoing only that origin", async () => {
  const port = await listen(LIST);
  for (const origin of ["http://localhost:3000", "http://192.168.1.10:3000"]) {
    const headers = await get(port, "/socket.io/?EIO=4&transport=polling", origin);
    expect(headers["access-control-allow-origin"]).toBe(origin);
    expect(headers["access-control-allow-credentials"]).toBe("true");
  }
});

test("Socket.IO CORS refuses an origin that is not configured", async () => {
  const port = await listen(LIST);
  const headers = await get(port, "/socket.io/?EIO=4&transport=polling", "http://evil.test");
  expect(headers["access-control-allow-origin"]).toBeUndefined();
});

test("the comma-joined string is never treated as one origin", async () => {
  const port = await listen(LIST);
  const headers = await get(port, "/socket.io/?EIO=4&transport=polling", LIST);
  expect(headers["access-control-allow-origin"]).toBeUndefined();
});

test("HTTP CORS follows the same list", async () => {
  const port = await listen(LIST);
  expect((await get(port, "/health", "http://192.168.1.10:3000"))["access-control-allow-origin"]).toBe("http://192.168.1.10:3000");
  expect((await get(port, "/health", "http://evil.test"))["access-control-allow-origin"]).toBeUndefined();
});

test("the default single-origin behavior is preserved", async () => {
  const port = await listen(undefined);
  expect((await get(port, "/health", "http://localhost:3000"))["access-control-allow-origin"]).toBe("http://localhost:3000");
});

test("a client from an allowed origin still connects over Socket.IO", async () => {
  const port = await listen(LIST);
  client = createClient(`http://127.0.0.1:${port}`, { transports: ["polling"], extraHeaders: { Origin: "http://192.168.1.10:3000" } });
  await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  expect(client.connected).toBe(true);
});
