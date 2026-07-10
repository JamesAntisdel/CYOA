import { describe, expect, it } from "vitest";

import {
  PATRON_TIERS,
  PATRON_TIERS_BY_ID,
  nextUpgradeTier,
  resolvePatronTier,
} from "../../../lib/billingConfig";

describe("billingConfig", () => {
  it("defines the four patronage tiers in the ladder", () => {
    expect(PATRON_TIERS.map((tier) => tier.id)).toEqual([
      "wanderer",
      "reader",
      "patron",
      "magus",
    ]);
  });

  it("only the paid Patron and Magus tiers are subscribable", () => {
    const subscribable = PATRON_TIERS.filter((tier) => tier.subscribable).map((tier) => tier.id);
    expect(subscribable).toEqual(["patron", "magus"]);
  });

  it("only Magus may play cinematic deaths", () => {
    expect(PATRON_TIERS_BY_ID.magus.canPlayCinematicDeath).toBe(true);
    expect(PATRON_TIERS_BY_ID.patron.canPlayCinematicDeath).toBe(false);
    expect(PATRON_TIERS_BY_ID.reader.canPlayCinematicDeath).toBe(false);
    expect(PATRON_TIERS_BY_ID.wanderer.canPlayCinematicDeath).toBe(false);
  });

  it("maps entitlements to patron tiers", () => {
    expect(resolvePatronTier({ entitlement: "pro", isClaimed: true }).id).toBe("magus");
    expect(resolvePatronTier({ entitlement: "unlimited", isClaimed: true }).id).toBe("patron");
    expect(resolvePatronTier({ entitlement: "free", isClaimed: true }).id).toBe("reader");
    expect(resolvePatronTier({ entitlement: "free", isClaimed: false }).id).toBe("wanderer");
  });

  it("nextUpgradeTier walks the ladder upward and skips non-subscribable tiers", () => {
    expect(nextUpgradeTier("wanderer")?.id).toBe("patron");
    expect(nextUpgradeTier("reader")?.id).toBe("patron");
    expect(nextUpgradeTier("patron")?.id).toBe("magus");
    expect(nextUpgradeTier("magus")).toBeNull();
  });
});
