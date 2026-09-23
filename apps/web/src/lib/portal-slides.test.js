import { test, expect } from "vitest";
import { portalSlides } from "./portal-slides.js";

test("ships at least one slide, each with a required action and a unique id", () => {
  expect(portalSlides.length).toBeGreaterThan(0);
  const ids = new Set(portalSlides.map((slide) => slide.id));
  expect(ids.size).toBe(portalSlides.length);
  for (const slide of portalSlides) {
    expect(slide.actionLabel.length).toBeGreaterThan(0);
    expect(slide.actionHref.length).toBeGreaterThan(0);
  }
});

test("every slide targets a real internal route, never an external URL", () => {
  for (const slide of portalSlides) {
    expect(slide.actionHref.startsWith("/")).toBe(true);
    expect(slide.actionHref).not.toMatch(/^\/\//);
    expect(slide.actionHref).not.toContain("://");
  }
});

test("the platform slide points to the full catalog, not straight into Quiz", () => {
  const platform = portalSlides.find((slide) => slide.id === "platform");
  expect(platform.actionHref).toBe("/jogos");
});

test("the solo slide reuses the same Quiz entry point as the group slide (no separate solo route exists)", () => {
  const group = portalSlides.find((slide) => slide.id === "quiz-group");
  const solo = portalSlides.find((slide) => slide.id === "quiz-solo");
  expect(group.actionHref).toBe("/jogos/quiz");
  expect(solo.actionHref).toBe("/jogos/quiz");
});

test("slides never carry a handler, a function, or other non-presentational data", () => {
  for (const slide of portalSlides) {
    for (const value of Object.values(slide)) {
      expect(typeof value).not.toBe("function");
    }
  }
});
