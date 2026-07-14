import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMagicLinkPlugin,
  buildSocialProviders,
  configuredSocialProviderIds,
  deliverMagicLink,
  isGmailConfigured,
  isMagicLinkConfigured,
  isResendConfigured,
  resolveGmailFrom,
  selectMagicLinkTransport,
} from "../betterAuth/providers";

describe("buildSocialProviders", () => {
  it("returns an empty config when no secrets are present", () => {
    expect(buildSocialProviders({})).toEqual({});
    expect(configuredSocialProviderIds({})).toEqual([]);
  });

  it("requires both client id and secret before wiring a provider", () => {
    expect(buildSocialProviders({ GOOGLE_CLIENT_ID: "id" })).toEqual({});
    expect(buildSocialProviders({ GOOGLE_CLIENT_SECRET: "secret" })).toEqual({});
    expect(configuredSocialProviderIds({ GOOGLE_CLIENT_ID: " " , GOOGLE_CLIENT_SECRET: "secret" })).toEqual([]);
  });

  it("wires only providers whose secrets are present", () => {
    const config = buildSocialProviders({
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
    });
    expect(config).toEqual({
      google: { clientId: "g-id", clientSecret: "g-secret" },
      github: { clientId: "gh-id", clientSecret: "gh-secret" },
    });
    expect(configuredSocialProviderIds({
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
    })).toEqual(["google", "github"]);
  });

  it("passes optional apple/microsoft extras when provided", () => {
    const config = buildSocialProviders({
      APPLE_CLIENT_ID: "a-id",
      APPLE_CLIENT_SECRET: "a-secret",
      APPLE_APP_BUNDLE_IDENTIFIER: "com.example.app",
      MICROSOFT_CLIENT_ID: "m-id",
      MICROSOFT_CLIENT_SECRET: "m-secret",
      MICROSOFT_TENANT_ID: "tenant-123",
      DISCORD_CLIENT_ID: "d-id",
      DISCORD_CLIENT_SECRET: "d-secret",
    });
    expect(config.apple).toEqual({
      clientId: "a-id",
      clientSecret: "a-secret",
      appBundleIdentifier: "com.example.app",
    });
    expect(config.microsoft).toEqual({
      clientId: "m-id",
      clientSecret: "m-secret",
      tenantId: "tenant-123",
    });
    expect(config.discord).toEqual({ clientId: "d-id", clientSecret: "d-secret" });
  });

  it("omits optional apple/microsoft extras when absent", () => {
    const config = buildSocialProviders({
      APPLE_CLIENT_ID: "a-id",
      APPLE_CLIENT_SECRET: "a-secret",
      MICROSOFT_CLIENT_ID: "m-id",
      MICROSOFT_CLIENT_SECRET: "m-secret",
    });
    expect(config.apple).toEqual({ clientId: "a-id", clientSecret: "a-secret" });
    expect(config.microsoft).toEqual({ clientId: "m-id", clientSecret: "m-secret" });
  });
});

describe("magic link", () => {
  it("is unconfigured without both an api key and from address", () => {
    expect(isMagicLinkConfigured({})).toBe(false);
    expect(isMagicLinkConfigured({ RESEND_API_KEY: "key" })).toBe(false);
    expect(isMagicLinkConfigured({ AUTH_EMAIL_FROM: "a@b.com" })).toBe(false);
    expect(buildMagicLinkPlugin({})).toBeNull();
  });

  it("is configured and builds a plugin when both are present", () => {
    const env = { RESEND_API_KEY: "key", AUTH_EMAIL_FROM: "noreply@theunwritten.app" };
    expect(isMagicLinkConfigured(env)).toBe(true);
    const plugin = buildMagicLinkPlugin(env);
    expect(plugin).not.toBeNull();
    expect(plugin?.id).toBe("magic-link");
  });

  it("is configured (and builds a plugin) with Gmail SMTP alone", () => {
    const env = { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" };
    expect(isGmailConfigured(env)).toBe(true);
    expect(isResendConfigured(env)).toBe(false);
    expect(isMagicLinkConfigured(env)).toBe(true);
    expect(buildMagicLinkPlugin(env)?.id).toBe("magic-link");
  });

  it("builds a plugin for the dev-log fallback with no real provider", () => {
    expect(buildMagicLinkPlugin({ CYOA_DEV_LOG_MAGIC_LINK: "1" })?.id).toBe("magic-link");
  });
});

describe("selectMagicLinkTransport", () => {
  const gmail = { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "pw" };
  const resend = { RESEND_API_KEY: "key", AUTH_EMAIL_FROM: "a@b.com" };

  it("prefers gmail, then resend, then dev-log, then none", () => {
    expect(selectMagicLinkTransport({ ...gmail, ...resend, CYOA_DEV_LOG_MAGIC_LINK: "1" })).toBe("gmail");
    expect(selectMagicLinkTransport({ ...resend, CYOA_DEV_LOG_MAGIC_LINK: "1" })).toBe("resend");
    expect(selectMagicLinkTransport({ CYOA_DEV_LOG_MAGIC_LINK: "1" })).toBe("dev-log");
    expect(selectMagicLinkTransport({})).toBe("none");
  });

  it("resolves the gmail From address (AUTH_EMAIL_FROM then GMAIL_USER)", () => {
    expect(resolveGmailFrom({ GMAIL_USER: "bot@gmail.com" })).toBe("bot@gmail.com");
    expect(resolveGmailFrom({ GMAIL_USER: "bot@gmail.com", AUTH_EMAIL_FROM: "hi@x.com" })).toBe("hi@x.com");
    expect(resolveGmailFrom({})).toBeUndefined();
  });
});

describe("deliverMagicLink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("schedules the gmail send when gmail is the transport", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    await deliverMagicLink(
      { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "pw" },
      { email: "reader@x.com", url: "https://x/verify" },
      schedule,
    );
    expect(schedule).toHaveBeenCalledWith({ email: "reader@x.com", url: "https://x/verify" });
  });

  it("dev-logs when only the dev flag is set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await deliverMagicLink({ CYOA_DEV_LOG_MAGIC_LINK: "1" }, { email: "r@x.com", url: "https://x/v" });
    expect(log).toHaveBeenCalledWith("[dev-magic-link] r@x.com -> https://x/v");
  });

  it("never rethrows when the gmail scheduler fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const schedule = vi.fn().mockRejectedValue(new Error("scheduler_down"));
    await expect(
      deliverMagicLink(
        { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "pw" },
        { email: "r@x.com", url: "https://x/v" },
        schedule,
      ),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });

  it("falls back to resend when gmail is selected but no scheduler is wired", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await deliverMagicLink(
      { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "pw", RESEND_API_KEY: "key", AUTH_EMAIL_FROM: "a@b.com" },
      { email: "r@x.com", url: "https://x/v" },
    );
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });
});
