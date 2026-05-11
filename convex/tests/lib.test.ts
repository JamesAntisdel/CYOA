import { describe, expect, it } from "vitest";

import {
  assertAccountSessionAccess,
  assertAdmin,
  assertOwns,
  forbidden,
  makeDayKey,
  projectCoopParticipant,
} from "../index";

describe("convex helpers", () => {
  it("projects co-op participants without private fields", () => {
    const projected = projectCoopParticipant(
      {
        participantId: "p1",
        accountId: "acct_private",
        guestTokenHash: "secret",
        displayName: "Reader",
        avatarInitial: "R",
        role: "player",
        lastSeenAt: 1_000,
      },
      1_500,
      { p1: "choice" },
    );

    expect(projected).toEqual({
      participantId: "p1",
      displayName: "Reader",
      avatarInitial: "R",
      role: "player",
      presence: "online",
      hasVoted: true,
    });
    expect(projected).not.toHaveProperty("accountId");
    expect(projected).not.toHaveProperty("guestTokenHash");
  });

  it("enforces admin and ownership helpers", () => {
    expect(() => assertAdmin({ _id: "acct" })).toThrow("admin_required");
    expect(() => assertAdmin({ _id: "acct", isAdmin: true })).not.toThrow();
    expect(() => assertOwns({ _id: "owner" }, { accountId: "other" })).toThrow("resource_not_owned");
    expect(() => assertOwns({ _id: "owner" }, { ownerAccountId: "owner" })).not.toThrow();
  });

  it("allows guest accounts and validates user account identity", async () => {
    const ctx = (subject?: string) => ({
      auth: {
        getUserIdentity: async () => (subject ? { subject } : null),
      },
    });

    await expect(
      assertAccountSessionAccess(ctx(), { _id: "guest", kind: "guest", guestTokenHash: "guest_hash" }, "guest_hash"),
    ).resolves.toBeUndefined();
    await expect(
      assertAccountSessionAccess(ctx(), { _id: "guest", kind: "guest", guestTokenHash: "guest_hash" }),
    ).rejects.toThrow("resource_not_owned");
    await expect(
      assertAccountSessionAccess(ctx("user_1"), { _id: "acct", kind: "user", userId: "user_1" }),
    ).resolves.toBeUndefined();
    await expect(
      assertAccountSessionAccess(ctx("user_2"), { _id: "acct", kind: "user", userId: "user_1" }),
    ).rejects.toThrow("resource_not_owned");
  });

  it("creates stable day keys and app errors", () => {
    expect(makeDayKey(new Date("2026-04-26T12:00:00.000Z"))).toBe("2026-04-26");
    expect(forbidden("x").code).toBe("forbidden");
  });
});
