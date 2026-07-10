export type AuthMode = "local" | "better-auth";

export const authMode: AuthMode =
  process.env.EXPO_PUBLIC_AUTH_MODE === "better-auth" ? "better-auth" : "local";

export const appBaseUrl = process.env.EXPO_PUBLIC_APP_URL ?? process.env.PUBLIC_APP_URL ?? "http://localhost:8081";

export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

export const convexSiteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

export const authBaseUrl = convexSiteUrl ?? appBaseUrl;

export function isConvexAuthConfigured() {
  return authMode === "better-auth" && Boolean(convexUrl && convexSiteUrl);
}
