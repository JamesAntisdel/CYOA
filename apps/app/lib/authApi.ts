import { SOCIAL_PROVIDER_IDS, type SocialProvider } from "@cyoa/shared";

import { authBaseUrl } from "./authConfig";
import { getErrorMessage, readJson } from "./authHttp";

/**
 * Client-side entry points for BetterAuth social (SSO) sign-in and email
 * magic-link. The Convex/BetterAuth server exposes these over HTTP; this module
 * POSTs to them directly (mirroring lib/authClient.ts's fetch style) and handles
 * the browser redirect the social flow returns.
 *
 * Provider availability lives on the server (client id/secret are secret), so the
 * client mirrors it through EXPO_PUBLIC_* env vars that the build injects:
 *   - EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS: comma-separated provider ids that are
 *     configured on the server, e.g. "google,github,apple".
 *   - EXPO_PUBLIC_AUTH_MAGIC_LINK: "1" | "true" when email magic link is wired.
 * The UI only renders providers listed here, so an unconfigured provider is never
 * shown as a silent no-op button.
 */

export type { SocialProvider };

export const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: "Google",
  apple: "Apple",
  github: "GitHub",
  microsoft: "Microsoft",
  discord: "Discord",
};

function readEnv(key: string): string | undefined {
  // env.d.ts declares only a fixed set of EXPO_PUBLIC_* keys; read the auth
  // mirror vars through a widened view so this stays a compile-clean lookup.
  return (process.env as unknown as Record<string, string | undefined>)[key];
}

/** Parse the server-configured provider list from its env-var string form. */
export function parseConfiguredProviders(raw: string | undefined): SocialProvider[] {
  if (!raw) return [];
  const requested = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return SOCIAL_PROVIDER_IDS.filter((provider) => requested.includes(provider));
}

/** Social providers the server has secrets for (and should render buttons for). */
export function getConfiguredSocialProviders(): SocialProvider[] {
  return parseConfiguredProviders(readEnv("EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS"));
}

/** True when the server can deliver email magic links. */
export function isMagicLinkAvailable(): boolean {
  const flag = readEnv("EXPO_PUBLIC_AUTH_MAGIC_LINK");
  return flag === "1" || flag === "true";
}

type AuthApiResult = { error: string | null };

function authUrl(path: string): string {
  return `${authBaseUrl.replace(/\/+$/, "")}/api/auth${path}`;
}

async function postAuth(path: string, body: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(authUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson(response);
    if (!response.ok) {
      return { data: null, error: getErrorMessage(data) ?? `auth_http_${response.status}` };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "auth_request_failed" };
  }
}

/**
 * Kick off an OAuth (SSO) sign-in. BetterAuth returns a provider authorization
 * URL; we navigate the browser/app to it. After the provider round-trips back to
 * the Convex callback, the session cookie is set and the browser lands on
 * `callbackURL`.
 */
export async function startSocialSignIn(
  provider: SocialProvider,
  options: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<AuthApiResult> {
  const { data, error } = await postAuth("/sign-in/social", {
    provider,
    ...(options.callbackURL ? { callbackURL: options.callbackURL } : {}),
    ...(options.errorCallbackURL ? { errorCallbackURL: options.errorCallbackURL } : {}),
  });
  if (error) return { error };
  const url = extractRedirectUrl(data);
  if (!url) return { error: "auth_no_redirect_url" };
  await openExternalUrl(url);
  return { error: null };
}

/** Request an email magic link. On success the email is sent by the server. */
export async function requestMagicLink(
  email: string,
  options: { callbackURL?: string } = {},
): Promise<AuthApiResult> {
  const { error } = await postAuth("/sign-in/magic-link", {
    email,
    ...(options.callbackURL ? { callbackURL: options.callbackURL } : {}),
  });
  return { error };
}

async function openExternalUrl(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.location) {
    window.location.href = url;
    return;
  }
  // Lazy-loaded so this module stays free of the React Native runtime at import
  // time (keeps it usable from node unit tests); native redirect uses Linking.
  const { Linking } = await import("react-native");
  await Linking.openURL(url);
}

function extractRedirectUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

