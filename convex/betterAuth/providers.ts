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

/**
 * Gmail SMTP magic-link delivery is gated on these env vars. The From address
 * falls back to `AUTH_EMAIL_FROM` and then to `GMAIL_USER`. `GMAIL_APP_PASSWORD`
 * is a Gmail 2FA *app password* (16 chars, spaces stripped), NOT the account
 * password. Delivery itself runs in a Node action (`./emailNode.ts`) because the
 * Convex HTTP/mutation runtime can't open a raw SMTP socket.
 */
export const GMAIL_ENV = {
  user: "GMAIL_USER",
  appPassword: "GMAIL_APP_PASSWORD",
  from: "AUTH_EMAIL_FROM",
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

/** True when Resend HTTP email delivery is fully configured. */
export function isResendConfigured(env: Env): boolean {
  return Boolean(read(env, MAGIC_LINK_ENV.resendApiKey)) && Boolean(read(env, MAGIC_LINK_ENV.from));
}

/** True when Gmail SMTP delivery is fully configured (user + app password). */
export function isGmailConfigured(env: Env): boolean {
  return Boolean(read(env, GMAIL_ENV.user)) && Boolean(read(env, GMAIL_ENV.appPassword));
}

/**
 * True when the environment can actually deliver a magic-link email through a
 * real provider (Gmail SMTP or Resend). Does NOT include the dev-log fallback —
 * that is handled separately in `buildMagicLinkPlugin` so a dev can complete
 * sign-in locally without any email provider.
 */
export function isMagicLinkConfigured(env: Env): boolean {
  return isGmailConfigured(env) || isResendConfigured(env);
}

/**
 * The delivery transport the magic-link plugin should use, in strict preference
 * order: Gmail SMTP → Resend → dev-log → none. Pure so the routing decision is
 * unit-testable without a live BetterAuth instance or network. `dev-log` is only
 * selected when no real provider is configured but `CYOA_DEV_LOG_MAGIC_LINK` is
 * set; `none` means the plugin should not even load.
 */
export type MagicLinkTransport = "gmail" | "resend" | "dev-log" | "none";

export function selectMagicLinkTransport(env: Env): MagicLinkTransport {
  if (isGmailConfigured(env)) return "gmail";
  if (isResendConfigured(env)) return "resend";
  if (read(env, "CYOA_DEV_LOG_MAGIC_LINK")) return "dev-log";
  return "none";
}

/** Resolve the From address for a Gmail send: AUTH_EMAIL_FROM → GMAIL_USER. */
export function resolveGmailFrom(env: Env): string | undefined {
  return read(env, GMAIL_ENV.from) ?? read(env, GMAIL_ENV.user);
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
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.email,
      subject: magicLinkSubject(env),
      html: renderMagicLinkHtml(params.url),
      text: renderMagicLinkText(params.url),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`magic_link_email_failed_${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

/** The email subject, honoring the `AUTH_EMAIL_SUBJECT` override. */
export function magicLinkSubject(env: Env): string {
  return read(env, MAGIC_LINK_ENV.subject) ?? "Your sign-in link";
}

/** Shared HTML body for the magic-link email (Resend + Gmail both render this). */
export function renderMagicLinkHtml(url: string): string {
  return [
    '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">',
    "<h2>Sign in to The Unwritten</h2>",
    "<p>Tap the button below to finish signing in. This link expires shortly.</p>",
    `<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;">Sign in</a></p>`,
    "<p>If you did not request this, you can safely ignore this email.</p>",
    "</div>",
  ].join("");
}

/** Shared plain-text body for the magic-link email. */
export function renderMagicLinkText(url: string): string {
  return `Sign in to The Unwritten:\n\n${url}\n\nThis link expires shortly. If you did not request it, ignore this email.`;
}

/**
 * Injected Gmail sender. Gmail delivery runs in a Convex Node action (raw SMTP
 * can't open from the HTTP/mutation runtime), so the caller (`createAuth` in
 * auth.ts) passes a closure that SCHEDULES that action against the request's
 * `ctx.scheduler`. Kept as an injected dependency so this module stays pure and
 * unit-testable, and so a scheduling failure can be caught here without ever
 * throwing the sign-in.
 */
export type GmailScheduler = (params: { email: string; url: string }) => Promise<void> | void;

/**
 * Build the magic-link plugin, or `null` when neither a real provider nor the
 * dev-log fallback is available. The returned plugin closes over `env` so
 * `sendMagicLink` reads live secrets. Delivery preference is Gmail SMTP → Resend
 * → dev-log (see `selectMagicLinkTransport`). A send failure is logged, never
 * rethrown, so a transient provider hiccup can't 500 the sign-in request.
 *
 * @param scheduleGmail  Invoked when the selected transport is Gmail. When
 *   absent (e.g. the plugin is built in a context with no scheduler) the send
 *   degrades to Resend/dev-log if those are configured, else it logs and no-ops.
 */
export function buildMagicLinkPlugin(env: Env, scheduleGmail?: GmailScheduler) {
  if (selectMagicLinkTransport(env) === "none") return null;
  return magicLink({
    sendMagicLink: async ({ email, url }) => {
      await deliverMagicLink(env, { email, url }, scheduleGmail);
    },
  });
}

/**
 * Route one magic-link send by the selected transport (Gmail → Resend → dev-log)
 * and NEVER rethrow — betterAuth turns a thrown `sendMagicLink` into a 500 on the
 * sign-in request, so a delivery hiccup is logged and swallowed instead. Exported
 * for unit tests; `buildMagicLinkPlugin`'s `sendMagicLink` is a thin wrapper.
 */
export async function deliverMagicLink(
  env: Env,
  params: { email: string; url: string },
  scheduleGmail?: GmailScheduler,
): Promise<void> {
  const transport = selectMagicLinkTransport(env);
  try {
    if (transport === "gmail" && scheduleGmail) {
      await scheduleGmail(params);
      return;
    }
    // Gmail selected but no scheduler wired: fall back to whatever else is
    // configured so the link still goes out.
    if ((transport === "gmail" || transport === "resend") && isResendConfigured(env)) {
      await sendMagicLinkEmail(env, params);
      return;
    }
    if (Boolean(read(env, "CYOA_DEV_LOG_MAGIC_LINK"))) {
      // Dev fallback: print the sign-in URL to the server log so a local
      // developer can complete sign-in without any email provider. UNSET
      // CYOA_DEV_LOG_MAGIC_LINK in any environment exposed to real users — it
      // makes every sign-in link readable to anyone with log access.
      // eslint-disable-next-line no-console -- dev-only sign-in aid
      console.log(`[dev-magic-link] ${params.email} -> ${params.url}`);
      return;
    }
    // eslint-disable-next-line no-console -- surface a misconfiguration
    console.error(`[magic-link] no delivery transport available for ${params.email}`);
  } catch (error) {
    // eslint-disable-next-line no-console -- delivery failure diagnostics
    console.error(`[magic-link] delivery failed for ${params.email}:`, error);
  }
}
