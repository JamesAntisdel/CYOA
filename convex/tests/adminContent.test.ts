import { describe, expect, it } from "vitest";

import {
  ADMIN_PAGE_DEFAULT,
  ADMIN_PAGE_MAX,
  aggregateStories,
  clampPageSize,
  projectBibleSummary,
  projectEndingRow,
  projectSaveRow,
  projectSceneRow,
  projectUserRow,
} from "../adminContent";

describe("adminContent — clampPageSize", () => {
  it("defaults an absent/invalid limit", () => {
    expect(clampPageSize(undefined)).toBe(ADMIN_PAGE_DEFAULT);
    expect(clampPageSize(0)).toBe(ADMIN_PAGE_DEFAULT);
    expect(clampPageSize(-5)).toBe(ADMIN_PAGE_DEFAULT);
    expect(clampPageSize(Number.NaN)).toBe(ADMIN_PAGE_DEFAULT);
  });

  it("caps an oversized limit and floors fractions", () => {
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(10.9)).toBe(10);
    expect(clampPageSize(1000)).toBe(ADMIN_PAGE_MAX);
  });
});

describe("adminContent — projectSaveRow", () => {
  it("projects a full save doc with the owner kind passed in", () => {
    const row = projectSaveRow(
      {
        _id: "save_1",
        storyId: "bone-cathedral",
        accountId: "acct_1",
        turnNumber: 4,
        status: "active",
        createdAt: 100,
      },
      "user",
    );
    expect(row).toEqual({
      saveId: "save_1",
      storyId: "bone-cathedral",
      ownerAccountId: "acct_1",
      ownerKind: "user",
      turnNumber: 4,
      status: "active",
      createdAt: 100,
    });
  });

  it("tolerates missing fields with safe defaults", () => {
    const row = projectSaveRow({ _id: "save_x" }, "unknown");
    expect(row).toEqual({
      saveId: "save_x",
      storyId: "",
      ownerAccountId: "",
      ownerKind: "unknown",
      turnNumber: 0,
      status: "unknown",
      createdAt: 0,
    });
  });
});

describe("adminContent — aggregateStories", () => {
  it("folds saves by storyId, counts statuses, and sorts by last activity", () => {
    const rows = aggregateStories([
      { _id: "s1", storyId: "alpha", status: "active", createdAt: 10, updatedAt: 15 },
      { _id: "s2", storyId: "alpha", status: "ended", createdAt: 20, updatedAt: 40 },
      { _id: "s3", storyId: "beta", status: "dead", createdAt: 30, updatedAt: 90 },
      { _id: "s4", storyId: "alpha", status: "ended_safely", createdAt: 5, updatedAt: 8 },
    ]);
    // beta has the newest activity (90) so it sorts first.
    expect(rows[0]).toEqual({
      storyId: "beta",
      saves: 1,
      active: 0,
      ended: 0,
      dead: 1,
      lastActivityAt: 90,
    });
    expect(rows[1]).toEqual({
      storyId: "alpha",
      saves: 3,
      active: 1,
      ended: 2, // ended + ended_safely
      dead: 0,
      lastActivityAt: 40,
    });
  });

  it("buckets storyless saves under empty string and returns [] for no saves", () => {
    expect(aggregateStories([])).toEqual([]);
    const rows = aggregateStories([{ _id: "s1" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storyId: "", saves: 1, lastActivityAt: 0 });
  });
});

describe("adminContent — projectUserRow", () => {
  it("surfaces email for user accounts and folds in resolved tier/saveCount", () => {
    const row = projectUserRow(
      { _id: "acct_1", kind: "user", userId: "reader@example.com", createdAt: 7, isAdmin: true },
      { tier: "pro", saveCount: 3 },
    );
    expect(row).toEqual({
      accountId: "acct_1",
      kind: "user",
      email: "reader@example.com",
      createdAt: 7,
      tier: "pro",
      isAdmin: true,
      saveCount: 3,
    });
  });

  it("nulls email for guests and defaults isAdmin false + floors saveCount", () => {
    const row = projectUserRow(
      { _id: "acct_2", kind: "guest", userId: "should-not-leak", createdAt: 9 },
      { tier: "free", saveCount: 2.9 },
    );
    expect(row.email).toBeNull();
    expect(row.kind).toBe("guest");
    expect(row.isAdmin).toBe(false);
    expect(row.saveCount).toBe(2);
  });
});

describe("adminContent — detail projections", () => {
  it("projectSceneRow flags terminal scenes", () => {
    expect(
      projectSceneRow({
        _id: "scene_1",
        turnNumber: 2,
        nodeId: "n2",
        streamStatus: "complete",
        terminal: { endingId: "e1" },
        createdAt: 50,
      }),
    ).toEqual({
      sceneId: "scene_1",
      turnNumber: 2,
      nodeId: "n2",
      streamStatus: "complete",
      isTerminal: true,
      createdAt: 50,
    });
    expect(projectSceneRow({ _id: "scene_2" }).isTerminal).toBe(false);
  });

  it("projectBibleSummary returns null when absent and drops the spoiler payload (BC10)", () => {
    expect(projectBibleSummary(null)).toBeNull();
    const summary = projectBibleSummary({
      status: "ready",
      attachedAtTurn: 3,
      lastRefreshAct: 2,
      retryCount: 1,
      bible: { secretEnding: "do not leak" },
    });
    expect(summary).toEqual({ status: "ready", attachedAtTurn: 3, lastRefreshAct: 2, retryCount: 1 });
    expect(summary).not.toHaveProperty("bible");
  });

  it("projectEndingRow maps label to null when absent", () => {
    expect(
      projectEndingRow({ endingId: "e1", label: "A Clear Route", firstSeen: 5, safetyEnding: true }),
    ).toEqual({ endingId: "e1", label: "A Clear Route", firstSeen: 5, safetyEnding: true });
    expect(projectEndingRow({ endingId: "e2" })).toEqual({
      endingId: "e2",
      label: null,
      firstSeen: 0,
      safetyEnding: false,
    });
  });
});
