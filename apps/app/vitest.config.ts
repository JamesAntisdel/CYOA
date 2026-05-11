import { defineConfig } from "vitest/config";

// Co-located vitest config for pure unit tests in apps/app.
// Tests must not import React Native runtime — they cover pure modules
// (e.g. the MediaPlate state machine reducer). Invoke via the workspace
// vitest binary, e.g. `pnpm --filter @cyoa/convex exec vitest run -c apps/app/vitest.config.ts`.
//
// No new package dependency is introduced; this config piggybacks on the
// vitest already present in the @cyoa/convex devDependencies.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    root: __dirname,
  },
});
