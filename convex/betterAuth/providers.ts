import { magicLink } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";

import { SOCIAL_PROVIDER_IDS, type SocialProvider as SocialProviderId } from "@cyoa/shared";

/**
 * Env-gated construction of BetterAuth social providers + the email magic-link
 * plugin. Every provider is opt-in: it is only wired when both its client id and
 * client secret are present in the environment. This keeps the auth config valid
 * in environments where OAuth secrets are not configured (dev/CI) while making the
 * code path fully functional the moment real secrets are supplied — no provider
 * ever silently does nothing.
 *
 * These helpers are pure (env is injected) so they can be unit-tested without a
 * live BetterAuth instance. See convex/tests/authProviders.test.ts.
 */

type Env = Record<string, string | undefined>;

type SocialProvidersConfig = NonNullable<BetterAuthOptions["socialProviders"]>;

// Canonical provider id list + type live in @cyoa/shared so the client auth
// surface and this BetterAuth config can't drift. Re-exported here for the
// existing importers (auth.ts, tests).
export type { SocialProviderId };
export { SOCIAL_PROVIDER_IDS };

/** Env var names that each social provider reads. */
export const SOCIAL_PROVIDER_ENV: Record<SocialProviderId, { clientId: string; clientSecret: string }> = {
  google: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
  apple: { clientId: "APPLE_CLIENT_ID", clientSecret: "APPLE_CLIENT_SECRET" },
  github: { clientId: "GITHUB_CLIENT_ID", clientSecret: "GITHUB_CLIENT_SECRET" },
  microsoft: { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
  discord: { clientId: "DISCORD_CLIENT_ID", clientSecret: "DISCORD_CLIENT_SECRET" },
};

/** Magic-link email delivery is gated on these env vars. */
export const MAGIC_LINK_ENV = {
  resendApiKey: "RESEND_API_KEY",
  from: "AUTH_EMAIL_FROM",
  subject: "AUTH_EMAIL_SUBJECT",
} as const;

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Provider ids that have both a client id and secret configured. */
export function configuredSocialProviderIds(env: Env): SocialProviderId[] {
  return SOCIAL_PROVIDER_IDS.filter((id) => {
    const keys = SOCIAL_PROVIDER_ENV[id];
    return Boolean(read(env, keys.clientId)) && Boolean(read(env, keys.clientSecret));
  });
}

/**
 * Build the `socialProviders` config object for betterAuth(), including only the
 * providers whose secrets are present. Returns `{}` when nothing is configured.
 */
export function buildSocialProviders(env: Env): SocialProvidersConfig {
  const config: SocialProvidersConfig = {};
  for (const id of configuredSocialProviderIds(env)) {
    const keys = SOCIAL_PROVIDER_ENV[id];
    const clientId = read(env, keys.clientId) as string;
    const clientSecret = read(env, keys.clientSecret) as string;
    switch (id) {
      case "google":
        config.google = { clientId, clientSecret };
        break;
      case "github":
        config.github = { clientId, clientSecret };
        break;
      case "discord":
        config.discord = { clientId, clientSecret };
        break;
      case "apple": {
        const appBundleIdentifier = read(env, "APPLE_APP_BUNDLE_IDENTIFIER");
        config.apple = {
          clientId,
          clientSecret,
          ...(appBundleIdentifier ? { appBundleIdentifier } : {}),
        };
        break;
      }
      case "microsoft": {
        const tenantId = read(env, "MICROSOFT_TENANT_ID");
        config.microsoft = {
          clientId,
          clientSecret,
          ...(tenantId ? { tenantId } : {}),
        };
        break;
      }
    }
  }
  return config;
}

/** True when the environment can actually deliver a magic-link email. */
export function isMagicLinkConfigured(env: Env): boolean {
  return Boolean(read(env, MAGIC_LINK_ENV.resendApiKey)) && Boolean(read(env, MAGIC_LINK_ENV.from));
}

/**
 * Deliver a magic-link email via Resend's HTTP API. Kept as a standalone function
 * so the network shape is easy to reason about (and swap for another provider).
 */
export async function sendMagicLinkEmail(env: Env, params: { email: string; url: string }): Promise<void> {
  const apiKey = read(env, MAGIC_LINK_ENV.resendApiKey);
  const from = read(env, MAGIC_LINK_ENV.from);
  if (!apiKey || !from) {
    throw new Error("magic_link_email_not_configured");
  }
  const subject = read(env, MAGIC_LINK_ENV.subject) ?? "Your sign-in link";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.email,
      subject,
      html: renderMagicLinkEmail(params.url),
      text: `Sign in to The Unwritten:\n\n${params.url}\n\nThis link expires shortly. If you did not request it, ignore this email.`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`magic_link_email_failed_${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

function renderMagicLinkEmail(url: string): string {
  return [
    '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">',
    "<h2>Sign in to The Unwritten</h2>",
    "<p>Tap the button below to finish signing in. This link expires shortly.</p>",
    `<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;">Sign in</a></p>`,
    "<p>If you did not request this, you can safely ignore this email.</p>",
    "</div>",
  ].join("");
}

/**
 * Build the magic-link plugin, or `null` when email delivery is not configured.
 * The returned plugin closes over `env` so `sendMagicLink` reads live secrets.
 */
export function buildMagicLinkPlugin(env: Env) {
  const configured = isMagicLinkConfigured(env);
  // Dev fallback: when no email provider is configured but
  // CYOA_DEV_LOG_MAGIC_LINK is set, still load the plugin and print the
  // sign-in URL to the server log so a local developer can complete sign-in
  // without Resend. UNSET this in any environment exposed to real users —
  // it makes every sign-in link readable to anyone with log access.
  const devLog = Boolean(read(env, "CYOA_DEV_LOG_MAGIC_LINK"));
  if (!configured && !devLog) return null;
  return magicLink({
    sendMagicLink: async ({ email, url }) => {
      if (configured) {
        await sendMagicLinkEmail(env, { email, url });
      } else {
        // eslint-disable-next-line no-console -- dev-only sign-in aid
        console.log(`[dev-magic-link] ${email} -> ${url}`);
      }
    },
  });
}
