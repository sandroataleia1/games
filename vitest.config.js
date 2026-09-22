import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "packages/contracts/test.js",
      "apps/realtime/test/**/*.test.js",
      "apps/web/src/**/*.test.js",
      "packages/database/test/**/*.test.js",
    ],
    testTimeout: 7000,
    hookTimeout: 30000,
  },
});
