import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cyoa/engine": resolve(__dirname, "../packages/engine/src/index.ts"),
      "@cyoa/shared": resolve(__dirname, "../packages/shared/src/index.ts"),
      "@cyoa/stories": resolve(__dirname, "../packages/stories/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      all: true,
      reportsDirectory: "../coverage/convex",
      include: ["**/*.ts"],
      exclude: [
        "auth.config.ts",
        "convex.config.ts",
        "schema.ts",
        "**/*.js",
        "**/types.ts",
        "tests/**",
        "node_modules/**",
        "vitest.config.ts",
      ],
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
      },
    },
  },
});
