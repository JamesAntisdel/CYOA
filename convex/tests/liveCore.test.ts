import { describe, expect, it } from "vitest";

import type { Story } from "@cyoa/engine";
import {
  buildCreateSavePlan,
  buildAccountProfile,
  buildArchiveAuthoredSeedPlan,
  buildCreatorSeedLibraryItems,
  buildCheckoutStartPlan,
  buildClaimGuestAccountUpdate,
  buildCreateAuthoredSeedPlan,
  buildDefaultEntitlement,
  buildGuestAccountSession,
  buildInitialSceneRecord,
  buildLibraryItems,
  buildMatureContentAccountUpdate,
  buildPublishAuthoredSeedPlan,
  authoredSeedStoryId,
  buildTurnPersistencePlan,
  createSaveRecord,
  mergeEntitlementUpdate,
  parseAuthoredSeedStoryId,
  submitTurn,
} from "../index";

const story: Story = {
  id: "story",
  version: 1,
  title: "Story Title",
  startNodeId: "start",
  initialState: {
    vitality: 3,
    currency: 0,
    inventory: [{ id: "coin", label: "Coin" }],
    attributes: {
      resolve: { id: "resolve", label: "Resolve", value: 2, visibility: "visible" },
    },
  },
  endings: {
    win: { id: "win", label: "Win", kind: "success" },
  },
  nodes: {
    start: {
      id: "start",
      seed: "Start.",
      choices: [{ id: "win", label: "Win", targetNodeId: "win" }],
    },
    win: { id: "win", endingId: "win", seed: "Done.", choices: [] },
  },
};

describe("live endpoint core", () => {
  it("builds new and existing guest account sessions", () => {
    const created = buildGuestAccountSession({
      existing: null,
      ageSelection: "18+",
      guestTokenHash: "hash",
      now: 10,
    });
    expect(created.created).toBe(true);
    expect(created.account.ageBand).toBe("18+");
    expect(created.projection.matureContentEnabled).toBe(false);

    const existing = buildGuestAccountSession({
      existing: { ...created.account, _id: "acct", lastActiveAt: 10 },
      ageSelection: "13-17",
      guestTokenHash: "hash",
      now: 20,
    });
    expect(existing.created).toBe(false);
    expect(existing.account.lastActiveAt).toBe(20);
    expect(existing.projection.accountId).toBe("acct");
  });

  it("builds default entitlement and create-save documents", () => {
    expect(buildDefaultEntitlement("acct", 5)).toMatchObject({
      accountId: "acct",
      tier: "free",
      includedTurnsPerDay: 10,
    });

    const save = buildCreateSavePlan({ accountId: "acct", story, mode: "story", now: 5, rngSeed: "seed" });
    const scene = buildInitialSceneRecord({ save, saveId: "save", story, now: 6 });

    expect(save.currentNodeId).toBe("start");
    expect(scene).toMatchObject({
      saveId: "save",
      nodeId: "start",
      turnNumber: 0,
      prose: "Start.",
      streamStatus: "complete",
      provider: "deterministic",
    });
    expect(scene.choiceViews).toHaveLength(1);
  });

  it("builds account profile, claim, and mature-content updates", () => {
    const account = {
      _id: "acct",
      kind: "user" as const,
      ageBand: "18+" as const,
      matureContentEnabled: false,
      createdAt: 1,
      lastActiveAt: 2,
    };
    const entitlement = mergeEntitlementUpdate(null, {
      accountId: "acct",
      tier: "pro",
      source: "stripe",
      status: "active",
      updatedAt: 3,
    });

    expect(buildAccountProfile({ account, entitlement })).toMatchObject({
      accountId: "acct",
      entitlementTier: "pro",
      dailyAllowance: "unlimited",
    });
    expect(
      buildClaimGuestAccountUpdate({
        guestAccount: { ...account, kind: "guest", guestTokenHash: "hash" },
        userId: "user",
        now: 4,
      }).updates,
    ).toMatchObject({ kind: "user", userId: "user", lastActiveAt: 4 });
    expect(buildMatureContentAccountUpdate({ account, entitlement, enabled: true, now: 5 })).toEqual({
      matureContentEnabled: true,
      matureContentEnabledAt: 5,
    });
    expect(buildMatureContentAccountUpdate({ account, entitlement, enabled: false, now: 6 })).toEqual({
      matureContentEnabled: false,
      matureContentEnabledAt: undefined,
    });
  });

  it("uses fallback profile and scene values for incomplete local records", () => {
    const account = {
      kind: "guest" as const,
      ageBand: "13-17" as const,
      guestTokenHash: "hash",
      matureContentEnabled: false,
      createdAt: 1,
      lastActiveAt: 8,
    };

    const fallbackProfile = buildAccountProfile({ account, entitlement: null });
    expect(fallbackProfile).toMatchObject({
      entitlementTier: "free",
      dailyAllowance: 10,
    });
    expect(fallbackProfile.accountId).toBeUndefined();

    const startNode = story.nodes.start;
    if (!startNode) throw new Error("fixture_start_node_missing");
    const { seed: _seed, ...startWithoutSeed } = startNode;
    const noSeedStory: Story = {
      ...story,
      nodes: {
        ...story.nodes,
        start: startWithoutSeed,
      },
    };
    const save = buildCreateSavePlan({ accountId: "acct", story: noSeedStory, mode: "story", now: 5, rngSeed: "seed" });
    expect(buildInitialSceneRecord({ save, saveId: "save", story: noSeedStory, now: 6 }).prose).toBe("");
  });

  it("builds creator seed lifecycle plans", () => {
    const owner = {
      _id: "creator",
      kind: "user" as const,
      ageBand: "18+" as const,
      matureContentEnabled: false,
      createdAt: 1,
      lastActiveAt: 1,
    };
    const draft = buildCreateAuthoredSeedPlan({ owner, title: " Seed ", story, now: 2 });
    const published = buildPublishAuthoredSeedPlan({ seed: draft, owner, now: 3 });
    const archived = buildArchiveAuthoredSeedPlan({ seed: published, owner, now: 4 });

    expect(draft).toMatchObject({ title: "Seed", status: "draft" });
    expect(published).toMatchObject({ status: "published", updatedAt: 3 });
    expect(archived).toMatchObject({ status: "archived", updatedAt: 4 });
  });

  it("projects published creator seeds for account libraries", () => {
    const owner = {
      _id: "creator",
      kind: "user" as const,
      ageBand: "18+" as const,
      matureContentEnabled: false,
      createdAt: 1,
      lastActiveAt: 1,
    };
    const draft = buildCreateAuthoredSeedPlan({ owner, title: " Seed ", story, now: 2 });
    const published = { ...buildPublishAuthoredSeedPlan({ seed: draft, owner, now: 3 }), _id: "seed-1" };
    const archived = { ...buildArchiveAuthoredSeedPlan({ seed: published, owner, now: 4 }), _id: "seed-2" };

    expect(authoredSeedStoryId("seed-1")).toBe("authored_seed:seed-1");
    expect(parseAuthoredSeedStoryId("authored_seed:seed-1")).toBe("seed-1");
    expect(parseAuthoredSeedStoryId("training-room")).toBeNull();

    const items = buildCreatorSeedLibraryItems({ seeds: [archived, published] });
    expect(items).toEqual([
      {
        seedId: "seed-1",
        storyId: "authored_seed:seed-1",
        title: "Seed",
        status: "published",
        opening: "Start.",
        updatedAt: 3,
      },
    ]);
    expect(() => authoredSeedStoryId(" ")).toThrow("creator_seed_id_required");
    const { _id: _publishedId, ...publishedWithoutId } = published;
    expect(() => buildCreatorSeedLibraryItems({ seeds: [publishedWithoutId] })).toThrow("creator_seed_id_required");
  });

  it("builds Stripe checkout start plans", () => {
    const plan = buildCheckoutStartPlan({
      checkout: {
        accountId: "acct",
        targetTier: "pro",
        interval: "annual",
        successUrl: "https://app/success",
        cancelUrl: "https://app/cancel",
      },
      prices: {
        unlimited: { monthly: "price_um", annual: "price_ua" },
        pro: { monthly: "price_pm", annual: "price_pa" },
      },
    });

    expect(plan.request.metadata).toMatchObject({ accountId: "acct", targetTier: "pro" });
    expect(plan.params.line_items).toEqual([{ price: "price_pa", quantity: 1 }]);
  });

  it("projects a sorted library", () => {
    const older = { ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "a" }), _id: "old" };
    const newer = {
      ...createSaveRecord({ accountId: "acct", story, mode: "hardcore", now: 2, rngSeed: "b" }),
      _id: "new",
      updatedAt: 9,
    };
    const dead = { ...older, _id: "dead", status: "dead" as const, updatedAt: 10 };
    const items = buildLibraryItems({
      saves: [older, newer, dead],
      storyTitles: new Map([["story", "Story Title"]]),
    });

    expect(items.map((item) => item.saveId)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({ title: "Story Title", mode: "hardcore" });

    const fallbackTitle = buildLibraryItems({
      saves: [{ ...older, _id: "fallback", storyId: "missing-story", updatedAt: 11 }],
      storyTitles: new Map(),
    });
    expect(fallbackTitle[0]).toMatchObject({ title: "missing-story" });

    const { _id: _olderId, ...missingIdSave } = older;
    expect(() =>
      buildLibraryItems({
        saves: [missingIdSave],
        storyTitles: new Map([["story", "Story Title"]]),
      }),
    ).toThrow("save_id_required");
  });

  it("builds a turn persistence plan", async () => {
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "seed" }),
      _id: "save",
    };
    const result = await submitTurn({
      save,
      story,
      choiceId: "win",
      requestId: "request-1",
      accountId: "acct",
      now: 2,
      dailyCounter: null,
      dailyAllowance: 3,
      dayKey: "2026-04-27",
      resetAt: 10,
    });
    const plan = buildTurnPersistencePlan({ result, saveId: "save", now: 3 });

    expect(plan.savePatch).toMatchObject({ currentNodeId: "win", turnNumber: 1, activeTurnRequestId: undefined });
    expect(plan.dailyCounter.turnsUsed).toBe(1);
    expect(plan.history).toMatchObject({ saveId: "save", provider: "deterministic" });
    expect(plan.scene).toMatchObject({ saveId: "save", nodeId: "win", prose: "Done.", streamStatus: "complete" });

    const fallbackProviderPlan = buildTurnPersistencePlan({
      result: {
        ...result,
        provider: "openai",
        history: { ...result.history, provider: "openai" },
      },
      saveId: "fallback-save",
      now: 4,
    });
    expect(fallbackProviderPlan.history.provider).toBe("deterministic");
    expect(fallbackProviderPlan.scene.provider).toBe("deterministic");

    const deepseekProviderPlan = buildTurnPersistencePlan({
      result: {
        ...result,
        provider: "deepseek",
        history: { ...result.history, provider: "deepseek" },
      },
      saveId: "deepseek-save",
      now: 5,
    });
    expect(deepseekProviderPlan.history.provider).toBe("deepseek");
    expect(deepseekProviderPlan.scene.provider).toBe("deepseek");

    expect(() => buildTurnPersistencePlan({ result, saveId: "", now: 5 })).toThrow("save_id_required");
  });
});
