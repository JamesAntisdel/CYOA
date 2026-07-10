import { describe, expect, it } from "vitest";

import {
  buildAccountExport,
  buildClaimGuestPlan,
  buildMatureContentUpdate,
  buildMediaPrefsUpdate,
  canEnableMatureContent,
  createAccountDeletionSummary,
  createGuestAccountRecord,
  DEFAULT_MEDIA_PREFS,
  projectAccount,
  requireEligibleAge,
  resolveMediaPrefs,
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
      mediaPrefs: DEFAULT_MEDIA_PREFS,
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
        // guestTokenHash is intentionally preserved (not cleared) so a claimed
        // account isn't locked out before SSO/magic-link sign-in exists.
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

  it("defaults mediaPrefs to all-enabled on the projection when the row has no override", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "18+",
      guestTokenHash: "secret",
      now,
    });
    const projection = projectAccount({ ...guest, _id: "acct" });
    expect(projection.mediaPrefs).toEqual({
      imagesEnabled: true,
      audioEnabled: true,
      videoEnabled: true,
    });
    expect(projection.mediaPrefs).toEqual(DEFAULT_MEDIA_PREFS);
  });

  it("surfaces stored mediaPrefs on the projection", () => {
    const guest = createGuestAccountRecord({
      ageSelection: "18+",
      guestTokenHash: "secret",
      now,
    });
    const stored: AccountRecord = {
      ...guest,
      _id: "acct",
      mediaPrefs: { imagesEnabled: true, audioEnabled: false, videoEnabled: false },
    };
    expect(projectAccount(stored).mediaPrefs).toEqual({
      imagesEnabled: true,
      audioEnabled: false,
      videoEnabled: false,
    });
  });

  it("resolves a missing or partial mediaPrefs to all-enabled defaults", () => {
    expect(resolveMediaPrefs({})).toEqual(DEFAULT_MEDIA_PREFS);
    // A malformed row (somehow lost a boolean field) reverts to true so
    // we never silently disable media for legacy readers.
    expect(
      resolveMediaPrefs({
        mediaPrefs: {
          imagesEnabled: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          audioEnabled: undefined as unknown as boolean,
          videoEnabled: true,
        },
      }),
    ).toEqual({ imagesEnabled: false, audioEnabled: true, videoEnabled: true });
  });

  it("builds a normalized mediaPrefs patch coercing truthy values to booleans", () => {
    expect(
      buildMediaPrefsUpdate({ imagesEnabled: true, audioEnabled: false, videoEnabled: true }),
    ).toEqual({
      mediaPrefs: { imagesEnabled: true, audioEnabled: false, videoEnabled: true },
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
