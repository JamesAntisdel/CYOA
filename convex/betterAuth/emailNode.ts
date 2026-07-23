"use node";

// Gmail SMTP magic-link delivery (Convex Node action).
//
// The BetterAuth magic-link plugin's `sendMagicLink` runs in the HTTP/mutation
// runtime, which cannot open a raw SMTP socket. So `createAuth` (auth.ts)
// schedules THIS action, which runs in the Node runtime (note the `"use node"`
// directive) and uses `nodemailer` to send over `smtp.gmail.com:587` (STARTTLS)
// authenticated with `GMAIL_USER` + `GMAIL_APP_PASSWORD`.
//
// GMAIL_APP_PASSWORD is a Gmail 2FA *app password* (Google Account → Security →
// App passwords), NOT the account login password. The From address is
// `AUTH_EMAIL_FROM` when set, else `GMAIL_USER`.
//
// The pure helpers (config parse + message build) live in ./providers.ts and are
// unit-tested there; the delivery function here is dependency-injectable
// (`createTransport`) so the sender is testable with a mocked nodemailer.

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";

import {
  GMAIL_ENV,
  magicLinkSubject,
  renderMagicLinkHtml,
  renderMagicLinkText,
  resolveGmailFrom,
} from "./providers";

type Env = Record<string, string | undefined>;

/** Minimal transport surface we depend on from nodemailer (for injection). */
export type MailTransport = {
  sendMail: (message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
};

export type CreateTransport = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => MailTransport;

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the Gmail SMTP credentials from the environment, or null when either
 * half is missing. `pass` has spaces stripped because Google displays app
 * passwords in `xxxx xxxx xxxx xxxx` groups that are easy to paste verbatim.
 */
export function gmailConfigFromEnv(env: Env): { user: string; pass: string; from: string } | null {
  const user = read(env, GMAIL_ENV.user);
  const pass = read(env, GMAIL_ENV.appPassword);
  if (!user || !pass) return null;
  const from = resolveGmailFrom(env) ?? user;
  return { user, pass: pass.replace(/\s+/g, ""), from };
}

/**
 * Send the magic-link email over Gmail SMTP. `createTransport` is injected (it
 * defaults to nodemailer's) so tests can drive this with a fake transport and
 * assert the message shape without touching the network or installing/mocking
 * the module loader. Throws on a missing config or SMTP failure — the caller
 * (the action handler) logs and never rethrows into the sign-in path.
 */
export async function deliverMagicLinkViaGmail(
  env: Env,
  params: { email: string; url: string },
  createTransport?: CreateTransport,
): Promise<void> {
  const config = gmailConfigFromEnv(env);
  if (!config) throw new Error("gmail_smtp_not_configured");

  const factory = createTransport ?? (await defaultCreateTransport());
  const transport = factory({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS upgrade on 587 (secure:true is for 465/implicit TLS)
    auth: { user: config.user, pass: config.pass },
  });

  await transport.sendMail({
    from: config.from,
    to: params.email,
    subject: magicLinkSubject(env),
    text: renderMagicLinkText(params.url),
    html: renderMagicLinkHtml(params.url),
  });
}

/**
 * Lazily load nodemailer's `createTransport`. Kept behind a function (rather
 * than a top-level import) so unit tests that inject `createTransport` never
 * pull the module in.
 */
async function defaultCreateTransport(): Promise<CreateTransport> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport as unknown as CreateTransport;
}

/**
 * Internal action scheduled by `createAuth`'s magic-link plugin. Reads the live
 * deployment env, sends via Gmail SMTP, and logs (never throws) on failure so a
 * delivery problem can't surface as a failed sign-in request.
 *
 * Path (BC): `betterAuth/emailNode:sendMagicLinkEmail`.
 */
export const sendMagicLinkEmail = internalActionGeneric({
  args: {
    email: v.string(),
    url: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      await deliverMagicLinkViaGmail(process.env as Env, { email: args.email, url: args.url });
    } catch (error) {
      // eslint-disable-next-line no-console -- delivery diagnostics; sign-in already returned
      console.error(`[magic-link:gmail] send failed for ${args.email}:`, error);
    }
  },
});
