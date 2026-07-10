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
        ...(process.env.JWKS ? { jwks: process.env.JWKS } : {}),
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
