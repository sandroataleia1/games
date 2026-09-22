import { describe, expect, test } from "vitest";
import { calculatePoints, isResponseWithinDeadline } from "../src/services/scoring.js";

describe("calculatePoints", () => {
  const base = { basePoints: 1000, durationMs: 1000, isCorrect: true };

  test("gives maximum speed bonus at the start", () => {
    expect(calculatePoints({ ...base, responseTimeMs: 0 })).toBe(1500);
  });
  test("gives half bonus in the middle", () => {
    expect(calculatePoints({ ...base, responseTimeMs: 500 })).toBe(1250);
  });
  test("gives base points exactly at the deadline", () => {
    expect(calculatePoints({ ...base, responseTimeMs: 1000 })).toBe(1000);
  });
  test("does not award a negative bonus beyond the deadline", () => {
    expect(calculatePoints({ ...base, responseTimeMs: 1500 })).toBe(1000);
  });
  test("awards zero for an incorrect or missing answer", () => {
    expect(calculatePoints({ ...base, responseTimeMs: 0, isCorrect: false })).toBe(0);
    expect(calculatePoints({ ...base, responseTimeMs: 1000, isCorrect: false })).toBe(0);
  });
  test("is deterministic when evaluated repeatedly", () => {
    const input = { ...base, responseTimeMs: 333 };
    expect(calculatePoints(input)).toBe(calculatePoints(input));
  });
  test("uses an inclusive deadline", () => {
    const endsAt = new Date("2026-09-22T00:00:01.000Z");
    expect(isResponseWithinDeadline(new Date(endsAt.getTime() - 1), endsAt)).toBe(true);
    expect(isResponseWithinDeadline(new Date(endsAt.getTime()), endsAt)).toBe(true);
    expect(isResponseWithinDeadline(new Date(endsAt.getTime() + 1), endsAt)).toBe(false);
  });
});