import eslint from "@eslint/js";
import globals from "globals";

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
];
