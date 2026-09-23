import eslint from "@eslint/js";
import globals from "globals";

// Dependency boundaries (ADR-009):
//   game-catalog -> platform-core -> composition root -> quiz runtime -> database primitives
// enforced here with no-restricted-imports (no extra tool), plus the static checks
// in packages/server-bootstrap/test/boundaries.test.js.
const boundary = (files, patterns) => ({ files, rules: { "no-restricted-imports": ["error", { patterns }] } });

export default [
  eslint.configs.recommended,
  { ignores: ["**/node_modules/**", "**/.next/**", ".local/**"] },
  {
    files: [
      "apps/realtime/**/*.js",
      "packages/**/*.js",
      "scripts/**/*.js",
      "vitest.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  // The platform core (database primitives + generic services) never depends on a game or on the composition root.
  boundary(["packages/database/src/**/*.js", "packages/database/tooling/**/*.js"], [{ group: ["@multygames/*"], message: "O núcleo da plataforma não pode depender de jogos, catálogo ou bootstrap (ADR-009)." }]),
  // The public contracts of a game and the server registry stay free of implementations.
  boundary(["packages/game-registry/src/**/*.js", "packages/game-runtime/src/**/*.js"], [{ group: ["@quizarena/*", "@multygames/game-quiz", "@multygames/game-quiz/*", "@multygames/server-bootstrap"], message: "Registro e contrato de runtime não podem importar implementações." }]),
  // The generic realtime host never imports a concrete game (the composition root wires them).
  boundary(["apps/realtime/src/**/*.js"], [{ group: ["@multygames/game-quiz", "@multygames/game-quiz/*", "@multygames/game-catalog"], message: "O host realtime é genérico: os jogos entram pelo composition root." }]),
  // The Quiz definition is web-safe: registry only.
  boundary(["packages/games/quiz/src/index.js", "packages/games/quiz/src/definition.js"], [{ group: ["@quizarena/*", "@multygames/game-runtime", "@multygames/server-bootstrap", "./server/*"], message: "A definição do Quiz não pode carregar código servidor." }]),
  // The Quiz server code does not know the composition root, the catalog or the transport.
  boundary(["packages/games/quiz/src/server/**/*.js"], [{ group: ["@multygames/server-bootstrap", "@multygames/game-catalog", "socket.io", "redis", "@socket.io/*"], message: "O runtime do Quiz recebe suas dependências; não importa bootstrap, catálogo nem transporte." }]),
];
