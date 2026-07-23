// Pure opt-in resolver for the "writer's desk" home (the-desk R1, design §0
// DK2). Client-only; no convex/server/engine.
//
// The desk renders on the home route ONLY when opted in via EITHER a build
// seam (`EXPO_PUBLIC_DESK_HOME === "1"`) OR the persisted reader setting
// (`deskHome`). Default OFF — when neither is on the home is byte-identical to
// today (R1.1/R7.1).
//
// This helper is PURE: it does NOT read `process.env` itself. The env value is
// read at the CALL SITE (app/index.tsx, Wave 2 / DK-HOME) as a LITERAL
// `process.env.EXPO_PUBLIC_DESK_HOME` access and passed in as `envFlag`, because
// Expo's web bundler statically inlines only literal reads — a dynamic
// `process.env[key]` lookup is left in the bundle and resolves to `undefined`
// at runtime (the same seam authApi.ts's magic-link flag + the Illustrated-Book
// picker use). Keeping the resolver pure also lets it transpile + import
// directly under `node --test` (see deskGate.test.mjs).
//
// React-free + dependency-free by design.

export type ResolveDeskInput = {
  // The literal `process.env.EXPO_PUBLIC_DESK_HOME` value from the call site.
  // Anything other than the exact string "1" (undefined, "", "0", "true", …)
  // reads as OFF — the flag is deliberately strict so a stray value can't
  // silently enable an experimental surface.
  envFlag: string | undefined;
  // The persisted "Experimental: Desk home" reader setting (useReaderSettings
  // `deskHome`). Default false.
  settingOn: boolean;
};

// True when the desk home is opted in: the build flag is exactly "1" OR the
// persisted setting is on. Default OFF — a missing/other flag AND a false
// setting → false.
export function resolveDeskEnabled({ envFlag, settingOn }: ResolveDeskInput): boolean {
  return envFlag === "1" || settingOn === true;
}
