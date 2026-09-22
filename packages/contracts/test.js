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
test("roomCreate defaults to a public, host-only room and rejects unknown fields", () => {
  const parsed = lobbySchemas.roomCreate.parse({ quizId: "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11" });
  expect(parsed).toMatchObject({ visibility: "PUBLIC", hostPlays: false });
  expect(lobbySchemas.roomCreate.safeParse({ quizId: "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11", visibility: "SECRET" }).success).toBe(false);
});
test("roomJoin no longer requires a display name (identity comes from the account)", () => {
  expect(lobbySchemas.roomJoin.safeParse({ roomCode: "ABC234" }).success).toBe(true);
});
test("public room DTO never carries tokens, hashes or internal identifiers", () => {
  const room = { roomCode: "ABC234", quizId: "3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11", hostName: "Ana", playerCount: 1, maxPlayers: 20, status: "WAITING", createdAt: "2026-09-22T00:00:00.000Z", canJoin: true };
  expect(publicRoomSchema.parse(room)).toEqual(room);
  for (const leaked of ["hostToken", "hostTokenHash", "reconnectTokenHash", "hostUserId", "id"]) expect(publicRoomSchema.safeParse({ ...room, [leaked]: "x" }).success).toBe(false);
});
