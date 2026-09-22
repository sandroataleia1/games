import { test, expect } from "vitest";
import { EVENTS, systemPingSchema, systemPongSchema, GAME_STATUS, listGames, listAvailableGames, getGameBySlug, publicRoomSchema, lobbySchemas } from "./src/index.js";

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

test("game catalog exposes only the Quiz game as available, with a stable route", () => {
  const games = listGames();
  expect(games.length).toBeGreaterThan(0);
  const available = listAvailableGames();
  expect(available).toEqual([expect.objectContaining({ slug: "quiz", status: GAME_STATUS.AVAILABLE, route: "/jogos/quiz" })]);
  expect(available.every((game) => game.status === GAME_STATUS.AVAILABLE)).toBe(true);
});
test("getGameBySlug finds a known game and returns null for unknown slugs", () => {
  expect(getGameBySlug("quiz")).toMatchObject({ id: "quiz" });
  expect(getGameBySlug("nao-existe")).toBeNull();
});
test("themeSelect and matchStart address a persistent room by number, no ad-hoc creation payload", () => {
  const quizId = "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11";
  expect(lobbySchemas.themeSelect.parse({ roomNumber: 3, quizId })).toEqual({ roomNumber: 3, quizId });
  expect(lobbySchemas.matchStart.parse({ roomNumber: 3 })).toEqual({ roomNumber: 3 });
  expect(lobbySchemas.themeSelect.safeParse({ roomNumber: 3, quizId, extra: true }).success).toBe(false);
});
test("roomEnter/roomLeave identify a room by its fixed number, no display name needed", () => {
  expect(lobbySchemas.roomEnter.parse({ roomNumber: 5 })).toEqual({ roomNumber: 5 });
  expect(lobbySchemas.roomEnter.safeParse({ roomNumber: "5" }).success).toBe(false);
  expect(lobbySchemas.roomLeave.parse({ roomNumber: 5 })).toEqual({ roomNumber: 5 });
});
test("public room DTO never carries tokens, hashes or internal identifiers", () => {
  const room = { roomNumber: 3, status: "OPEN", quizId: "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11", quizTitle: "Países", playerCount: 1, players: [{ accountId: "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11", displayName: "Ana" }], serverTime: "2026-09-22T00:00:00.000Z" };
  expect(publicRoomSchema.parse(room)).toEqual(room);
  for (const leaked of ["hostToken", "hostTokenHash", "reconnectTokenHash", "hostUserId", "id", "currentSessionId"]) expect(publicRoomSchema.safeParse({ ...room, [leaked]: "x" }).success).toBe(false);
});
