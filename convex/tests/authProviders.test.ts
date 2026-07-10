import { describe, expect, it } from "vitest";

import {
  buildMagicLinkPlugin,
  buildSocialProviders,
  configuredSocialProviderIds,
  isMagicLinkConfigured,
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
});
