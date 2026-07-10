import { describe, expect, it } from "vitest";

import { parseConfiguredProviders } from "../authApi";

describe("parseConfiguredProviders", () => {
  it("returns an empty list when unset", () => {
    expect(parseConfiguredProviders(undefined)).toEqual([]);
    expect(parseConfiguredProviders("")).toEqual([]);
  });

  it("parses a comma-separated list into known providers in canonical order", () => {
    expect(parseConfiguredProviders("github, google")).toEqual(["google", "github"]);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseConfiguredProviders("  GOOGLE , Apple ")).toEqual(["google", "apple"]);
  });

  it("ignores unknown provider ids", () => {
    expect(parseConfiguredProviders("google,facebook,discord")).toEqual(["google", "discord"]);
  });
});
