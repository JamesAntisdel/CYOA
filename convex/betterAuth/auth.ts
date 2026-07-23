import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { makeFunctionReference } from "convex/server";
import type { GenericCtx } from "@convex-dev/better-auth";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import { buildMagicLinkPlugin, buildSocialProviders, type GmailScheduler } from "./providers";

export const authComponent = createClient<DataModel>(components.betterAuth);

const basePath = "/api/auth";

/**
 * Return a usable static JWKS or `undefined`. Rejects the `[]` placeholder and
 * blank/whitespace so a stale-but-truthy env value can't force the static-JWKS
 * path (which throws "Not implemented" when the private half is missing).
 */
function validStaticJwks(): string | undefined {
  const raw = (process.env.JWKS ?? "").trim();
  if (raw.length === 0 || raw === "[]") return undefined;
  return raw;
}

export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = getSiteUrl();
  // Social providers + magic link are env-gated: each is only wired when its
  // secrets are present, so the config stays valid without OAuth/email creds and
  // becomes functional the moment they are supplied. See ./providers.ts.
  const socialProviders = buildSocialProviders(process.env);
  const magicLinkPlugin = buildMagicLinkPlugin(process.env, makeGmailScheduler(ctx));
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
        // Treat the `[]` placeholder (and blank) as UNSET — env removal on the
        // local backend is unreliable, so guard here rather than trusting the
        // deployment env. A truthy-but-invalid JWKS made createJwk throw
        // "Not implemented" and killed /api/auth/convex/token.
        ...(validStaticJwks() ? { jwks: validStaticJwks() as string } : {}),
        // Self-heal token generation when the signing key's alg no longer
        // matches a stored key (e.g. after a BETTER_AUTH_SECRET rotation): roll
        // the DB keys and retry once instead of hard-failing the token endpoint.
        // Only active on the DB-managed (non-static-JWKS) path.
        ...(validStaticJwks() ? {} : { jwksRotateOnTokenGenerationError: true }),
        options: { basePath },
      }),
      ...(magicLinkPlugin ? [magicLinkPlugin] : []),
    ],
  });
}

/**
 * Build the Gmail-send scheduler passed to the magic-link plugin, or `undefined`
 * when this ctx has no scheduler (e.g. `createAuth` invoked from a query context
 * for token verification). The magic-link SEND path only runs inside the
 * `/sign-in/magic-link` HTTP action, whose ctx IS an action ctx with a
 * scheduler — so Gmail delivery is scheduled there. Scheduling (not `runAction`)
 * keeps it fire-and-forget: a delivery failure never blocks the sign-in
 * response. The plugin degrades to Resend/dev-log when this returns undefined.
 */
function makeGmailScheduler(ctx: GenericCtx<DataModel>): GmailScheduler | undefined {
  const scheduler = (ctx as { scheduler?: { runAfter: (delayMs: number, ref: unknown, args: unknown) => Promise<unknown> } })
    .scheduler;
  if (!scheduler || typeof scheduler.runAfter !== "function") return undefined;
  return async ({ email, url }) => {
    await scheduler.runAfter(
      0,
      makeFunctionReference<"action">("betterAuth/emailNode:sendMagicLinkEmail"),
      { email, url },
    );
  };
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
