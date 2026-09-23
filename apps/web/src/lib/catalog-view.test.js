import { test, expect } from "vitest";
import { buildCatalogView } from "./catalog-view.js";

// Synthetic only - never registered in the application.
const trivia = { key: "TRIVIA", slug: "trivia", name: "Quiz e conhecimentos" };
const cards = { key: "CARDS", slug: "cards", name: "Cartas" };
const bySlug = (list) => (slug) => list.find((category) => category.slug === slug) ?? null;
const game = (key, categoryKeys) => ({ definition: { key, categoryKeys } });
const quiz = game("quiz", ["TRIVIA"]);
const truco = game("truco", ["CARDS"]);
const both = { games: [quiz, truco], publicCategories: [trivia, cards], getCategoryBySlug: bySlug([trivia, cards]) };

test("with a single public category there is no filter bar (it would be redundant)", () => {
  const view = buildCatalogView({ games: [quiz], publicCategories: [trivia], getCategoryBySlug: bySlug([trivia]), categorySlug: undefined });
  expect(view.filtersVisible).toBe(false);
  expect(view.games).toEqual([quiz]);
});

test("with two or more public categories the filters appear", () => {
  const view = buildCatalogView({ ...both, categorySlug: undefined });
  expect(view.filtersVisible).toBe(true);
  expect(view.games).toEqual([quiz, truco]);
});

test("?categoria=<slug> filters on the server side to that category's games", () => {
  const view = buildCatalogView({ ...both, categorySlug: "cards" });
  expect(view.active).toEqual(cards);
  expect(view.games).toEqual([truco]);
  expect(view.unknownCategory).toBe(false);
});

test("an unknown category falls back to every game and is reported, never an empty page", () => {
  const view = buildCatalogView({ ...both, categorySlug: "nao-existe" });
  expect(view.unknownCategory).toBe(true);
  expect(view.active).toBeNull();
  expect(view.games).toEqual([quiz, truco]);
});

test("an empty or missing categoria parameter is not treated as unknown", () => {
  for (const categorySlug of [undefined, ""]) {
    const view = buildCatalogView({ games: [quiz], publicCategories: [trivia], getCategoryBySlug: bySlug([trivia]), categorySlug });
    expect(view.unknownCategory).toBe(false);
  }
});
