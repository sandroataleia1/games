import { test, expect } from "vitest";
import { wrapIndex } from "./carousel-index.js";

test("wraps forward past the last slide back to the first (circular progression)", () => {
  expect(wrapIndex(3, 3)).toBe(0);
  expect(wrapIndex(4, 3)).toBe(1);
});

test("wraps backward past the first slide to the last (circular progression)", () => {
  expect(wrapIndex(-1, 3)).toBe(2);
  expect(wrapIndex(-4, 3)).toBe(2);
});

test("with a single slide, every index resolves to 0 - no crash, no NaN", () => {
  expect(wrapIndex(0, 1)).toBe(0);
  expect(wrapIndex(1, 1)).toBe(0);
  expect(wrapIndex(-5, 1)).toBe(0);
});

test("with zero slides, resolves to 0 instead of dividing by zero", () => {
  expect(wrapIndex(0, 0)).toBe(0);
  expect(Number.isNaN(wrapIndex(2, 0))).toBe(false);
});
