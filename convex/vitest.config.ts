import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cyoa/engine": resolve(__dirname, "../packages/engine/src/index.ts"),
      "@cyoa/shared": resolve(__dirname, "../packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
