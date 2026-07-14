import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import type { GenericCtx } from "@convex-dev/better-auth";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import { buildMagicLinkPlugin, buildSocialProviders } from "./providers";

export const authComponent = createClient<DataModel>(components.betterAuth);

const basePath = "/api/auth";

export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = getSiteUrl();
  // Social providers + magic link are env-gated: each is only wired when its
  // secrets are present, so the config stays valid without OAuth/email creds and
  // becomes functional the moment they are supplied. See ./providers.ts.
  const socialProviders = buildSocialProviders(process.env);
  const magicLinkPlugin = buildMagicLinkPlugin(process.env);
  return betterAuth({
    basePath,
    baseURL: siteUrl,
    trustedOrigins: getTrustedOrigins(),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    plugins: [
      convex({
        authConfig,
        // Static JWKS is a VERIFICATION-side optimization only: it must be the
        // PUBLIC half of a keypair whose PRIVATE half the component already
        // persisted (via `npx convex run` key generation). When `JWKS` is set
        // but the private key is missing (e.g. the local backend's DB was reset
        // after JWKS was pinned), the plugin's `createJwk` throws
        // "Not implemented" and `/api/auth/convex/token` returns that error, so
        // no session JWT is ever minted. Leaving `JWKS` UNSET (the default, and
        // what scripts/dev/convex-local-dev.sh enforces by stripping the `[]`
        // placeholder) makes the component manage the keypair in its own DB —
        // signing AND verification both work with no external coordination.
        ...(process.env.JWKS ? { jwks: process.env.JWKS } : {}),
        // Self-heal token generation when the signing key's alg no longer
        // matches a stored key (e.g. after a BETTER_AUTH_SECRET rotation): roll
        // the DB keys and retry once instead of hard-failing the token endpoint.
        // Only active on the DB-managed (non-static-JWKS) path.
        ...(process.env.JWKS ? {} : { jwksRotateOnTokenGenerationError: true }),
        options: { basePath },
      }),
      ...(magicLinkPlugin ? [magicLinkPlugin] : []),
    ],
  });
}

export const { getAuthUser } = authComponent.clientApi();

function getSiteUrl(): string {
  return process.env.CONVEX_SITE_URL ?? process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3211";
}

function getTrustedOrigins(): string[] {
  return [process.env.PUBLIC_APP_URL, process.env.EXPO_PUBLIC_APP_URL, getSiteUrl()]
    .filter((origin): origin is string => typeof origin === "string" && origin.length > 0)
    .map((origin) => origin.replace(/\/+$/, ""));
}
