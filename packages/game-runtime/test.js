import { test, expect } from "vitest";
import { createGameRegistry, defineGameModule, GAME_STATUS } from "@multygames/game-registry";
import { defineGameRuntime, createGameRuntimeRegistry, RUNTIME_PERSISTENCE_HOOKS, RUNTIME_REALTIME_HOOKS } from "./src/index.js";

const definition = (key, status = GAME_STATUS.AVAILABLE) => ({
  key, slug: key, name: key, shortDescription: key, description: key, status, route: `/jogos/${key}`,
  releasedAt: "2026-01-01T00:00:00-03:00", categoryKeys: ["TRIVIA"], minPlayers: 1, maxPlayers: 4, supportsSolo: true, supportsPublicRooms: true, supportsPrivateRooms: false,
  visual: { accent: "red", gradient: "red", icon: "X" },
});
const gameModule = (key, status, withRealtime = true) => defineGameModule({ definition: definition(key, status), implementation: { web: `apps/web/${key}`, ...(withRealtime ? { realtime: `test/${key}` } : {}) } });
const noop = async () => {};
const runtime = (gameKey, overrides = {}) => ({
  gameKey,
  persistence: { prepareMatch: noop, createMatchState: noop, createParticipantState: noop },
  realtime: { roomProjection: { schema: { parse: (value) => value }, extras: async () => new Map() }, registerHandlers() {}, onRoomEnter: noop, onRoomLeave: noop, onSocketDisconnect: noop, onMatchStarted: noop, recoverMatch: noop },
  ...overrides,
});

test("the contract lists exactly the hooks that are really called", () => {
  expect(RUNTIME_PERSISTENCE_HOOKS).toEqual(["prepareMatch", "createMatchState", "createParticipantState"]);
  expect(RUNTIME_REALTIME_HOOKS).toEqual(["registerHandlers", "onRoomEnter", "onRoomLeave", "onSocketDisconnect", "onMatchStarted", "recoverMatch"]);
});

test("a runtime must implement every hook and cannot carry a generic command handler", () => {
  for (const hook of RUNTIME_PERSISTENCE_HOOKS) expect(() => defineGameRuntime(runtime("quiz", { persistence: { ...runtime("quiz").persistence, [hook]: undefined } }))).toThrow();
  for (const hook of RUNTIME_REALTIME_HOOKS) expect(() => defineGameRuntime(runtime("quiz", { realtime: { ...runtime("quiz").realtime, [hook]: undefined } }))).toThrow();
  expect(() => defineGameRuntime(runtime("quiz", { handleCommand: noop }))).toThrow();
  expect(() => defineGameRuntime(runtime("quiz", { realtime: { ...runtime("quiz").realtime, handleCommand: noop } }))).toThrow();
  expect(() => defineGameRuntime(runtime("Bad Key"))).toThrow();
});

test("a defined runtime is immutable", () => {
  const defined = defineGameRuntime(runtime("quiz"));
  expect(Object.isFrozen(defined)).toBe(true);
  expect(Object.isFrozen(defined.persistence)).toBe(true);
  expect(Object.isFrozen(defined.realtime)).toBe(true);
});

test("the registry resolves runtimes by gameKey only and is immutable after construction", () => {
  const catalog = createGameRegistry([gameModule("a-game"), gameModule("b-game")]);
  const registry = createGameRuntimeRegistry({ catalog, runtimes: [runtime("a-game"), runtime("b-game")] });
  expect(registry.get("a-game").gameKey).toBe("a-game");
  expect(registry.get("missing")).toBeNull();
  expect(registry.has("b-game")).toBe(true);
  expect(registry.keys()).toEqual(["a-game", "b-game"]);
  expect(Object.isFrozen(registry)).toBe(true);
  expect(Object.isFrozen(registry.keys())).toBe(true);
});

test("a duplicate runtime key is refused", () => {
  const catalog = createGameRegistry([gameModule("a-game")]);
  expect(() => createGameRuntimeRegistry({ catalog, runtimes: [runtime("a-game"), runtime("a-game")] })).toThrow(/duplicado/);
});

test("a runtime without a catalog definition is refused", () => {
  const catalog = createGameRegistry([gameModule("a-game")]);
  expect(() => createGameRuntimeRegistry({ catalog, runtimes: [runtime("a-game"), runtime("ghost")] })).toThrow(/ghost/);
});

test("an AVAILABLE game that declares a realtime implementation but has no runtime stops startup", () => {
  const catalog = createGameRegistry([gameModule("a-game")]);
  expect(() => createGameRuntimeRegistry({ catalog, runtimes: [] })).toThrow(/a-game/);
});

test("COMING_SOON games, DISABLED games and web-only games need no runtime; a disabled game may keep one for history", () => {
  const catalog = createGameRegistry([gameModule("soon", GAME_STATUS.COMING_SOON), gameModule("old", GAME_STATUS.DISABLED), gameModule("web-only", GAME_STATUS.AVAILABLE, false)]);
  expect(() => createGameRuntimeRegistry({ catalog, runtimes: [] })).not.toThrow();
  const withHistory = createGameRuntimeRegistry({ catalog, runtimes: [runtime("old")] });
  expect(withHistory.has("old")).toBe(true);
});
