import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

// Must agree with `betterAuth/auth.ts` `validStaticJwks()`: a stale/blank
// `JWKS="[]"` is treated as UNSET on BOTH sides, else the convex plugin's
// parseAuthConfig rejects the config ("Static JWKS detected in auth config, but
// missing from Convex plugin") and every push fails.
const rawJwks = (process.env.JWKS ?? "").trim();
const staticJwks = rawJwks.length > 0 && rawJwks !== "[]" ? rawJwks : undefined;

export default {
  providers: [
    getAuthConfigProvider(staticJwks ? { jwks: staticJwks } : {}),
  ],
} satisfies AuthConfig;
