import { test, expect } from "vitest";
import { catalogMetadata } from "./catalog-metadata.js";

test("the /jogos catalog route has its own title and description, not a copy of the homepage's", () => {
  expect(catalogMetadata.title).toMatch(/todos os jogos/i);
  expect(catalogMetadata.description).toBe("Jogos para curtir sozinho ou com a turma.");
});
