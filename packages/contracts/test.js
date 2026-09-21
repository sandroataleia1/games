import { test, expect } from "vitest";
import { EVENTS, systemPingSchema, systemPongSchema } from "./src/index.js";

const ping = { id: "request-1", sentAt: "2026-09-21T18:00:00.000Z" };
test("event names and valid ping contract", () => {
  expect(EVENTS.SYSTEM_PING).toBe("system:ping");
  expect(EVENTS.SYSTEM_PONG).toBe("system:pong");
  expect(systemPingSchema.parse(ping)).toEqual(ping);
});
test.each([
  null,
  {},
  { sentAt: ping.sentAt },
  { ...ping, id: "" },
  { ...ping, id: "a".repeat(129) },
  { ...ping, sentAt: "now" },
  { ...ping, unexpected: true },
])("rejects invalid ping %j", (payload) => {
  expect(systemPingSchema.safeParse(payload).success).toBe(false);
});
test("pong preserves correlation and includes server timestamp", () => {
  const pong = { ...ping, serverAt: "2026-09-21T18:00:01.000Z" };
  expect(systemPongSchema.parse(pong)).toEqual(pong);
});
test.each([{}, ping, { ...ping, serverAt: "now" }, { ...ping, serverAt: 123 }])(
  "rejects invalid pong %j",
  (payload) => {
    expect(systemPongSchema.safeParse(payload).success).toBe(false);
  },
);
