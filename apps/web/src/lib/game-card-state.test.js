import { test, expect } from "vitest";
import { resolveCardState } from "./game-card-state.js";

function definitionWith(status) {
  return { key: "synthetic", status, route: "/jogos/synthetic" };
}

test("AVAILABLE renders with an action, in every variant", () => {
  for (const variant of ["compact", "catalog"]) {
    const state = resolveCardState(definitionWith("AVAILABLE"), variant);
    expect(state.playable).toBe(true);
  }
});

test("COMING_SOON never offers a start action, in any variant", () => {
  for (const variant of ["compact", "catalog"]) {
    const state = resolveCardState(definitionWith("COMING_SOON"), variant);
    expect(state.playable).toBe(false);
    expect(state.statusLabel).toBe("Em breve");
  }
});

test("DISABLED never offers a start action, in any variant", () => {
  for (const variant of ["compact", "catalog"]) {
    const state = resolveCardState(definitionWith("DISABLED"), variant);
    expect(state.playable).toBe(false);
  }
});

test("compact card blocks an unavailable game: no action, and the badge is unambiguous even though compact is otherwise discreet", () => {
  const state = resolveCardState(definitionWith("COMING_SOON"), "compact");
  expect(state.playable).toBe(false);
  expect(state.showBadge).toBe(true);
});

test("compact card stays discreet (no badge) only while AVAILABLE", () => {
  const state = resolveCardState(definitionWith("AVAILABLE"), "compact");
  expect(state.showBadge).toBe(false);
});

test("catalog card blocks an unavailable game and always shows its badge", () => {
  for (const status of ["COMING_SOON", "DISABLED"]) {
    const state = resolveCardState(definitionWith(status), "catalog");
    expect(state.playable).toBe(false);
    expect(state.showBadge).toBe(true);
  }
});

test("catalog always shows a badge, even for AVAILABLE", () => {
  const state = resolveCardState(definitionWith("AVAILABLE"), "catalog");
  expect(state.showBadge).toBe(true);
});

test("no variant ever marks a non-AVAILABLE game playable - the component only renders a real href when playable is true", () => {
  for (const status of ["COMING_SOON", "DISABLED"]) {
    for (const variant of ["compact", "catalog"]) {
      expect(resolveCardState(definitionWith(status), variant).playable).toBe(false);
    }
  }
});
