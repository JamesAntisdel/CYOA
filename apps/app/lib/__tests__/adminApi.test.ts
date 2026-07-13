// Admin content browser client (product.md operator intent, Req 27): BC1 path
// contract + BC2 tolerant adapters (pagination shape, null-for-absent mapping,
// spoiler-free bible summary).

import { describe, expect, it } from "vitest";

import {
  ADMIN_CONTENT_PATHS,
  adaptSaveDetail,
  adaptSavesPage,
  adaptStories,
  adaptUserDetail,
  adaptUsersPage,
} from "../adminApi";

describe("adminApi — path contract (BC1)", () => {
  it("uses full registered convex paths incl. the file/dir prefix", () => {
    expect(ADMIN_CONTENT_PATHS.listStories).toBe("adminContent:listStories");
    expect(ADMIN_CONTENT_PATHS.listSaves).toBe("adminContent:listSaves");
    expect(ADMIN_CONTENT_PATHS.listUsers).toBe("adminContent:listUsers");
    expect(ADMIN_CONTENT_PATHS.getSaveDetail).toBe("adminContent:getSaveDetail");
    expect(ADMIN_CONTENT_PATHS.getUserDetail).toBe("adminContent:getUserDetail");
    expect(ADMIN_CONTENT_PATHS.devGrantAdmin).toBe("account:devGrantAdmin");
    expect(ADMIN_CONTENT_PATHS.promoteUser).toBe("account:promoteUser");
  });
});

describe("adminApi — adaptStories (BC2)", () => {
  it("maps a stories payload", () => {
    const rows = adaptStories({
      stories: [
        { storyId: "bone-cathedral", saves: 5, active: 2, ended: 2, dead: 1, lastActivityAt: 99 },
      ],
    });
    expect(rows).toEqual([
      { storyId: "bone-cathedral", saves: 5, active: 2, ended: 2, dead: 1, lastActivityAt: 99 },
    ]);
  });

  it("tolerates garbage and missing shapes", () => {
    expect(adaptStories(null)).toEqual([]);
    expect(adaptStories(undefined)).toEqual([]);
    expect(adaptStories({ stories: null })).toEqual([]);
    expect(adaptStories({ stories: [null, { storyId: "x" }] })).toEqual([
      { storyId: "x", saves: 0, active: 0, ended: 0, dead: 0, lastActivityAt: 0 },
    ]);
  });
});

describe("adminApi — adaptSavesPage / adaptUsersPage (pagination shape, BC2)", () => {
  it("maps a saves page and carries the cursor + isDone", () => {
    const page = adaptSavesPage({
      page: [
        {
          saveId: "s1",
          storyId: "alpha",
          ownerAccountId: "a1",
          ownerKind: "user",
          turnNumber: 3,
          status: "active",
          createdAt: 10,
        },
      ],
      cursor: "CURSOR_2",
      isDone: false,
    });
    expect(page.page).toHaveLength(1);
    expect(page.cursor).toBe("CURSOR_2");
    expect(page.isDone).toBe(false);
    expect(page.page[0]!.ownerKind).toBe("user");
  });

  it("treats a null cursor as the terminal page", () => {
    const page = adaptSavesPage({ page: [], cursor: null, isDone: true });
    expect(page).toEqual({ page: [], cursor: null, isDone: true });
    // A missing cursor also reads as done.
    expect(adaptSavesPage({ page: [] }).isDone).toBe(true);
  });

  it("maps a users page, dropping null email to an absent key (BC4)", () => {
    const page = adaptUsersPage({
      page: [
        { accountId: "a1", kind: "user", email: "reader@example.com", createdAt: 1, tier: "pro", isAdmin: true, saveCount: 4 },
        { accountId: "a2", kind: "guest", email: null, createdAt: 2, tier: "free", isAdmin: false, saveCount: 0 },
      ],
      cursor: "C",
      isDone: false,
    });
    expect(page.page[0]).toEqual({
      accountId: "a1",
      kind: "user",
      email: "reader@example.com",
      createdAt: 1,
      tier: "pro",
      isAdmin: true,
      saveCount: 4,
    });
    // guest → no email key at all.
    expect("email" in page.page[1]!).toBe(false);
    expect(page.page[1]!.kind).toBe("guest");
  });

  it("tolerates a garbage page payload", () => {
    expect(adaptUsersPage(null)).toEqual({ page: [], cursor: null, isDone: true });
    expect(adaptSavesPage({ page: [null, 5] }).page).toEqual([]);
  });
});

describe("adminApi — adaptSaveDetail (BC2 + BC10 spoiler-free bible)", () => {
  it("maps scenes, keeps the bible summary spoiler-free, and null-maps labels", () => {
    const detail = adaptSaveDetail({
      saveId: "s1",
      storyId: "alpha",
      ownerAccountId: "a1",
      ownerKind: "user",
      status: "ended",
      turnNumber: 6,
      createdAt: 10,
      updatedAt: 20,
      sceneCount: 2,
      scenes: [
        { sceneId: "sc1", turnNumber: 1, nodeId: "n1", streamStatus: "complete", isTerminal: false, createdAt: 11 },
        { sceneId: "sc2", turnNumber: 2, nodeId: "n2", streamStatus: "complete", isTerminal: true, createdAt: 12 },
      ],
      bible: { status: "ready", attachedAtTurn: 3, lastRefreshAct: 2, retryCount: 1 },
      endings: [
        { endingId: "e1", label: "A Clear Route", firstSeen: 15, safetyEnding: false },
        { endingId: "e2", label: null, firstSeen: 16, safetyEnding: true },
      ],
    });
    expect(detail).not.toBeNull();
    expect(detail!.scenes).toHaveLength(2);
    expect(detail!.scenes[1]!.isTerminal).toBe(true);
    expect(detail!.bible).toEqual({ status: "ready", attachedAtTurn: 3, lastRefreshAct: 2, retryCount: 1 });
    expect(detail!.endings[0]!.label).toBe("A Clear Route");
    expect("label" in detail!.endings[1]!).toBe(false);
  });

  it("returns null for a missing save and omits an absent bible", () => {
    expect(adaptSaveDetail(null)).toBeNull();
    expect(adaptSaveDetail({})).toBeNull();
    const detail = adaptSaveDetail({ saveId: "s2", bible: null });
    expect(detail).not.toBeNull();
    expect("bible" in detail!).toBe(false);
    expect(detail!.scenes).toEqual([]);
    expect(detail!.endings).toEqual([]);
  });
});

describe("adminApi — adaptUserDetail (BC2)", () => {
  it("maps a user detail incl. entitlement status and their saves", () => {
    const detail = adaptUserDetail({
      accountId: "a1",
      kind: "user",
      email: "reader@example.com",
      ageBand: "18+",
      isAdmin: true,
      tier: "pro",
      entitlementStatus: "active",
      createdAt: 5,
      lastActiveAt: 9,
      saveCount: 1,
      saves: [
        { saveId: "s1", storyId: "alpha", ownerAccountId: "a1", ownerKind: "user", turnNumber: 2, status: "active", createdAt: 6 },
      ],
    });
    expect(detail!.email).toBe("reader@example.com");
    expect(detail!.entitlementStatus).toBe("active");
    expect(detail!.saves).toHaveLength(1);
  });

  it("returns null for missing, and omits absent email/entitlementStatus for a guest", () => {
    expect(adaptUserDetail(null)).toBeNull();
    const detail = adaptUserDetail({ accountId: "a2", kind: "guest", email: null });
    expect(detail!.kind).toBe("guest");
    expect("email" in detail!).toBe(false);
    expect("entitlementStatus" in detail!).toBe(false);
    expect(detail!.tier).toBe("free");
  });
});
