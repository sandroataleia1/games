import { test, expect } from "vitest";
import { homeMetadata } from "./home-metadata.js";

test("the homepage exposes MultyGames as name and description in its metadata", () => {
  expect(homeMetadata.title).toBe("MultyGames");
  expect(homeMetadata.description).toBe("Jogos para curtir sozinho ou com a turma.");
});
