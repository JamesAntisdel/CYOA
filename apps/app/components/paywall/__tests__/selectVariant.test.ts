import { describe, expect, it } from "vitest";

import { selectPaywallVariant } from "../selectVariant";

describe("selectPaywallVariant", () => {
  it("renders Soft when the daily candle has fully burned", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 5, turnsAllowed: 5 },
        reason: "daily_limit",
      }),
    ).toBe("soft");
  });

  it("renders Inline at the last available turn", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 4, turnsAllowed: 5 },
        reason: "daily_limit",
      }),
    ).toBe("inline");
  });

  it("renders TopBar when several turns remain", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 1, turnsAllowed: 5 },
        reason: "daily_limit",
      }),
    ).toBe("topbar");
  });

  it("renders Inline for Pro media on uncapped accounts", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 12, turnsAllowed: null },
        reason: "pro_media",
      }),
    ).toBe("inline");
  });

  it("renders TopBar for daily-limit on uncapped accounts (never blocks)", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 12, turnsAllowed: null },
        reason: "daily_limit",
      }),
    ).toBe("topbar");
  });

  it("treats over-cap as Soft", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 10, turnsAllowed: 5 },
        reason: "daily_limit",
      }),
    ).toBe("soft");
  });

  it("renders Inline for credits when a single turn remains", () => {
    expect(
      selectPaywallVariant({
        candle: { turnsUsed: 4, turnsAllowed: 5 },
        reason: "credits",
      }),
    ).toBe("inline");
  });
});
