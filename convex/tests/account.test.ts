import { describe, expect, it } from "vitest";

import {
  buildAccountExport,
  buildClaimGuestPlan,
  buildMatureContentUpdate,
  canEnableMatureContent,
  createAccountDeletionSummary,
  createGuestAccountRecord,
  projectAccount,
  requireEligibleAge,
  shouldPurgeGuest,
  type AccountRecord,
} from "../account";
import { AppError } from "../index";

const now = 1_000;

function userAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    _id: "acct",
    kind: "user",
    userId: "user",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: now,
    lastActiveAt: now,
    ...overrides,
  };
}

describe("account domain", () => {
  it("blocks under-13 before guest account creation", () => {
    try {
      requireEligibleAge("under_13");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("age_ineligible");
    }
    expect(() =>
      createGuestAccountRecord({ ageSelection: "under_13", guestTokenHash: "hash", now }),
    ).toThrow("The story is only available for ages 13 and older.");
  });

  it("creates eligible guest account records with age band only", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "13-17",
      guestTokenHash: "hash",
      now,
    });

    expect(guest).toMatchObject({
      kind: "guest",
      ageBand: "13-17",
      guestTokenHash: "hash",
      matureContentEnabled: false,
    });
    expect(guest).not.toHaveProperty("dateOfBirth");
    expect(guest.ttlExpiresAt).toBeGreaterThan(now);
  });

  it("projects accounts without token hashes or user ids", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "18+",
      guestTokenHash: "secret",
      now,
    });

    expect(projectAccount({ ...guest, _id: "acct" })).toEqual({
      accountId: "acct",
      kind: "guest",
      ageBand: "18+",
      matureContentEnabled: false,
    });
  });

  it("builds guest claim updates without deleting owned data", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "18+",
      guestTokenHash: "secret",
      now,
    });
    const plan = buildClaimGuestPlan({ ...guest, _id: "guest" }, "user_1", now + 1);

    expect(plan).toEqual({
      guestAccountId: "guest",
      userId: "user_1",
      updates: {
        kind: "user",
        userId: "user_1",
        guestTokenHash: undefined,
        ttlExpiresAt: undefined,
        lastActiveAt: now + 1,
      },
    });
  });

  it("allows mature content only for authenticated paid active 18+ accounts", () => {
    expect(canEnableMatureContent(userAccount(), { tier: "unlimited", status: "active" })).toBe(true);
    expect(canEnableMatureContent(userAccount({ ageBand: "13-17" }), { tier: "pro", status: "active" })).toBe(false);
    expect(canEnableMatureContent(userAccount({ kind: "guest" }), { tier: "pro", status: "active" })).toBe(false);
    expect(canEnableMatureContent(userAccount(), { tier: "free", status: "active" })).toBe(false);
    expect(canEnableMatureContent(userAccount(), { tier: "pro", status: "expired" })).toBe(false);
  });

  it("builds mature content updates with explicit eligibility checks", () => {
    expect(
      buildMatureContentUpdate(userAccount(), { tier: "pro", status: "active" }, true, now),
    ).toEqual({ matureContentEnabled: true, matureContentEnabledAt: now });
    expect(
      buildMatureContentUpdate(userAccount(), { tier: "pro", status: "active" }, false, now),
    ).toEqual({ matureContentEnabled: false, matureContentEnabledAt: undefined });
    expect(() =>
      buildMatureContentUpdate(userAccount({ ageBand: "13-17" }), { tier: "pro", status: "active" }, true, now),
    ).toThrow("mature_content_not_allowed");
  });

  it("identifies expired guests and exports redacted account data", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "13-17",
      guestTokenHash: "secret",
      now,
      ttlMs: 10,
    });

    expect(shouldPurgeGuest(guest, now + 11)).toBe(true);
    expect(buildAccountExport(guest)).toEqual({
      kind: "guest",
      ageBand: "13-17",
      matureContentEnabled: false,
      createdAt: now,
      lastActiveAt: now,
      isAdmin: false,
    });
  });

  it("creates empty deletion summaries with explicit counters", () => {
    expect(createAccountDeletionSummary("acct")).toEqual({
      accountId: "acct",
      savesDeleted: 0,
      scenesDeleted: 0,
      turnHistoryDeleted: 0,
      endingsDeleted: 0,
      entitlementsDeleted: 0,
      usageMetersDeleted: 0,
      dailyCountersDeleted: 0,
      analyticsDeleted: 0,
      assetsDeleted: 0,
      taleReadsDeleted: 0,
      taleForksDeleted: 0,
      authoredSeedsArchived: 0,
      publishedTalesRevoked: 0,
    });
  });
});
