import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import type { GenericCtx } from "@convex-dev/better-auth";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

const basePath = "/api/auth";

export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = getSiteUrl();
  return betterAuth({
    basePath,
    baseURL: siteUrl,
    trustedOrigins: getTrustedOrigins(),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      convex({
        authConfig,
        ...(process.env.JWKS ? { jwks: process.env.JWKS } : {}),
        options: { basePath },
      }),
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
