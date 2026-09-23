import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // The portal must never load server code: no database, runtimes, Quiz server, Redis, Prisma or the Socket.IO server.
  {
    files: ["src/**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@quizarena/database", "@multygames/game-runtime", "@multygames/server-bootstrap", "@multygames/game-quiz/*", "@prisma/client", "redis", "socket.io", "@socket.io/*"], message: "O portal não pode importar código servidor (ADR-009)." }] }],
    },
  },
]);

export default eslintConfig;
