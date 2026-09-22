import { test, expect } from "vitest";
import { safeInternalPath, withNext } from "./safe-redirect.js";

test.each([
  "/jogos/quiz",
  "/painel",
  "/salas/ABC234",
  "/jogos/quiz/quizzes/3b9a6b6a-9b1a-4c9e-8f8a-8b3c9a9d1e11",
  "/",
])("accepts internal path %s", (path) => {
  expect(safeInternalPath(path)).toBe(path);
});

test.each([
  ["https://evil.com", "external URL"],
  ["http://evil.com/", "external URL"],
  ["//evil.com", "protocol-relative URL"],
  ["///evil.com", "triple slash"],
  ["/\\evil.com", "backslash trick"],
  ["javascript:alert(1)", "javascript scheme"],
  ["data:text/html,evil", "data scheme"],
  ["/jogos\\://evil.com", "embedded scheme after slash"],
  ["", "empty string"],
  [null, "null"],
  [undefined, "undefined"],
  [42, "non-string"],
  ["jogos/quiz", "missing leading slash"],
  ["/jogos/quiz\nSet-Cookie: x=1", "control character injection"],
])("rejects malicious/invalid target: %s (%s)", (candidate) => {
  expect(safeInternalPath(candidate, "/fallback")).toBe("/fallback");
});

test("withNext appends a validated next param and omits it when unsafe", () => {
  expect(withNext("/login", "/jogos/quiz")).toBe("/login?next=%2Fjogos%2Fquiz");
  expect(withNext("/login", "https://evil.com")).toBe("/login");
  expect(withNext("/login", null)).toBe("/login");
});
