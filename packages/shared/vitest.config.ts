import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        lines: 100,
        functions: 100,
      },
    },
  },
});
