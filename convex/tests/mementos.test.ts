import { describe, expect, it } from "vitest";

import type { ContentPolicyContext } from "@cyoa/shared";

import { MEMENTO_GRANTED, deriveActMemento, mintActMementoIfDue } from "../mementos";

// ---------------------------------------------------------------------------
// deriveActMemento — total + deterministic derivation matrix (R1.1 / AM2).
// ---------------------------------------------------------------------------

describe("deriveActMemento (act-mementos R1.1 / AM2)", () => {
  it("composes label from actLabel and description from the fired beat", () => {
    const m = deriveActMemento({
      act: 2,
      actLabel: "The Drowned Bell Tolls",
      beatLabel: "You cut the mooring rope.",
      storyTitle: "Tide of Ash",
    });
    expect(m).toEqual({
      act: 2,
      label: "Act II — The Drowned Bell Tolls",
      description: "You cut the mooring rope.",
      storyTitle: "Tide of Ash",
    });
  });

  it("falls back to 'Act N of <title>' when the arc label is absent (AM2)", () => {
    const m = deriveActMemento({ act: 2, storyTitle: "Tide of Ash" });
    expect(m.label).toBe("Act II of Tide of Ash");
  });

  it("falls back to the fixed book-voice line when no beat label is available", () => {
    const m = deriveActMemento({ act: 3, actLabel: "Ruin", storyTitle: "Tide of Ash" });
    expect(m.label).toBe("Act III — Ruin");
    expect(m.description.length).toBeGreaterThan(0);
    expect(m.description).not.toBe("Ruin");
  });

  it("matches ChapterEnd's actRoman across the numeral range", () => {
    expect(deriveActMemento({ act: 1, storyTitle: "T" }).label).toContain("Act I ");
    expect(deriveActMemento({ act: 2, storyTitle: "T" }).label).toContain("Act II ");
    expect(deriveActMemento({ act: 3, storyTitle: "T" }).label).toContain("Act III ");
    expect(deriveActMemento({ act: 5, storyTitle: "T" }).label).toContain("Act V ");
    expect(deriveActMemento({ act: 6, storyTitle: "T" }).label).toContain("Act 6 ");
    // out-of-range low / non-finite floor to "I"
    expect(deriveActMemento({ act: 0, storyTitle: "T" }).label).toContain("Act I ");
    expect(deriveActMemento({ act: -3, storyTitle: "T" }).label).toContain("Act I ");
    expect(deriveActMemento({ act: Number.NaN, storyTitle: "T" }).label).toContain("Act I ");
  });

  it("clamps label ≤80 and description ≤160", () => {
    const m = deriveActMemento({
      act: 2,
      actLabel: "L".repeat(200),
      beatLabel: "D".repeat(400),
      storyTitle: "T",
    });
    expect(m.label.length).toBe(80);
    expect(m.description.length).toBe(160);
  });

  it("stays total on a blank story title", () => {
    const m = deriveActMemento({ act: 2, storyTitle: "   " });
    expect(m.storyTitle.length).toBeGreaterThan(0);
    expect(m.label).toBe(`Act II of ${m.storyTitle}`);
  });

  it("is deterministic — identical input yields a deep-equal memento", () => {
    const input = { act: 2, actLabel: "A", beatLabel: "B", storyTitle: "T" };
    expect(deriveActMemento(input)).toEqual(deriveActMemento(input));
  });
});

// ---------------------------------------------------------------------------
// mintActMementoIfDue — fake-ctx mint matrix (R1.1–R1.5, R2.1).
// ---------------------------------------------------------------------------

type AnyDoc = Record<string, any>;

function makeCtx(seed: { mementos?: AnyDoc[]; analytics_events?: AnyDoc[] } = {}) {
  const tables: { mementos: AnyDoc[]; analytics_events: AnyDoc[] } & Record<string, AnyDoc[]> = {
    mementos: seed.mementos ?? [],
    analytics_events: seed.analytics_events ?? [],
  };
  let n = 0;
  const ctx = {
    db: {
      query(table: string) {
        const rows = tables[table] ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return rows.find((row) => constraints.every(([f, val]) => row[f] === val)) ?? null;
          },
        };
        return chain;
      },
      async insert(table: string, doc: AnyDoc) {
        const _id = `${table}_${++n}`;
        const row = { _id, ...doc };
        (tables[table] ??= []).push(row);
        return _id;
      },
    },
  };
  return { ctx, tables };
}

const policyContext: ContentPolicyContext = {
  entitlementTier: "free",
  matureContentEnabled: false,
  surface: "generation",
};

function baseInput() {
  return {
    accountId: "acct1",
    saveId: "save1",
    storyId: "story1",
    act: 2,
    arc: { actLabel: "The Drowned Bell Tolls" },
    firedBeatLabel: "You cut the mooring rope.",
    storyTitle: "Tide of Ash",
    policyContext,
    now: 1_700_000_000_000,
  };
}

describe("mintActMementoIfDue (act-mementos R1.1–R1.5, R2.1)", () => {
  it("mints a memento row on an eligible act crossing", async () => {
    const { ctx, tables } = makeCtx();
    const out = await mintActMementoIfDue(ctx, baseInput());

    expect(out.minted).toBe(true);
    expect(tables.mementos).toHaveLength(1);
    const row = tables.mementos[0]!;
    expect(row).toMatchObject({
      accountId: "acct1",
      saveId: "save1",
      storyId: "story1",
      act: 2,
      label: "Act II — The Drowned Bell Tolls",
      description: "You cut the mooring rope.",
      storyTitle: "Tide of Ash",
      createdAt: 1_700_000_000_000,
    });
    // no dailyId key present when the run is not a Daily (cleanDoc drops undefined)
    expect("dailyId" in row).toBe(false);
  });

  it("includes dailyId on a Daily run and in the analytics payload", async () => {
    const { ctx, tables } = makeCtx();
    const out = await mintActMementoIfDue(ctx, { ...baseInput(), dailyId: "daily-2026-07-20" });

    expect(out.minted).toBe(true);
    expect(tables.mementos[0]!.dailyId).toBe("daily-2026-07-20");
    const evt = tables.analytics_events[0]!;
    expect(evt.eventName).toBe(MEMENTO_GRANTED);
    expect(evt.payload).toMatchObject({ storyId: "story1", act: 2, dailyId: "daily-2026-07-20" });
    expect(evt.saveId).toBe("save1");
  });

  it("fires memento.granted fire-and-forget with the design payload", async () => {
    const { ctx, tables } = makeCtx();
    await mintActMementoIfDue(ctx, baseInput());

    expect(tables.analytics_events).toHaveLength(1);
    const evt = tables.analytics_events[0]!;
    expect(evt.eventName).toBe(MEMENTO_GRANTED);
    expect(evt.payload).toMatchObject({ storyId: "story1", act: 2 });
    expect("dailyId" in evt.payload).toBe(false);
    expect(evt.accountId).toBe("acct1");
    expect(evt.saveId).toBe("save1");
  });

  it("is idempotent per (saveId, act) — a rewind re-cross does not duplicate (R1.2)", async () => {
    const existing = {
      _id: "mementos_pre",
      accountId: "acct1",
      saveId: "save1",
      act: 2,
      label: "Act II — Original",
      description: "kept",
      storyTitle: "Tide of Ash",
      createdAt: 1,
    };
    const { ctx, tables } = makeCtx({ mementos: [existing] });
    const out = await mintActMementoIfDue(ctx, baseInput());

    expect(out.minted).toBe(false);
    expect(out.mementoId).toBe("mementos_pre");
    expect(tables.mementos).toHaveLength(1);
    expect(tables.mementos[0]!.label).toBe("Act II — Original"); // original survives
    expect(tables.analytics_events).toHaveLength(0);
  });

  it("mints independently for a different act on the same save", async () => {
    const act2 = {
      _id: "mementos_pre",
      accountId: "acct1",
      saveId: "save1",
      act: 2,
      label: "Act II",
      description: "d",
      storyTitle: "Tide of Ash",
      createdAt: 1,
    };
    const { ctx, tables } = makeCtx({ mementos: [act2] });
    const out = await mintActMementoIfDue(ctx, { ...baseInput(), act: 3, arc: { actLabel: "Ruin" } });

    expect(out.minted).toBe(true);
    expect(tables.mementos).toHaveLength(2);
    expect(tables.mementos[1]!.act).toBe(3);
    expect(tables.mementos[1]!.label).toBe("Act III — Ruin");
  });

  it("no-ops on an arc-less / legacy save (R1.4)", async () => {
    const { ctx, tables } = makeCtx();
    // explicit null arc
    expect((await mintActMementoIfDue(ctx, { ...baseInput(), arc: null })).minted).toBe(false);
    // arc key absent entirely (legacy save carries no arc)
    const { arc: _omit, ...noArc } = baseInput();
    expect((await mintActMementoIfDue(ctx, noArc)).minted).toBe(false);
    expect(tables.mementos).toHaveLength(0);
    expect(tables.analytics_events).toHaveLength(0);
  });

  it("no-ops on an authored (non-llm) save (R1.4)", async () => {
    const { ctx, tables } = makeCtx();
    const out = await mintActMementoIfDue(ctx, { ...baseInput(), isAuthored: true });
    expect(out.minted).toBe(false);
    expect(tables.mementos).toHaveLength(0);
  });

  it("no-ops on a co-op follower client (R1.4)", async () => {
    const { ctx, tables } = makeCtx();
    const out = await mintActMementoIfDue(ctx, { ...baseInput(), isFollower: true });
    expect(out.minted).toBe(false);
    expect(tables.mementos).toHaveLength(0);
  });

  it("no-ops when the act entered is not a real crossing (< 2)", async () => {
    const { ctx, tables } = makeCtx();
    for (const act of [1, 0, -1, Number.NaN]) {
      expect((await mintActMementoIfDue(ctx, { ...baseInput(), act })).minted).toBe(false);
    }
    expect(tables.mementos).toHaveLength(0);
  });

  it("degrades a policy-blocked label + description to neutral fallback text (R1.3)", async () => {
    const { ctx, tables } = makeCtx();
    const out = await mintActMementoIfDue(ctx, {
      ...baseInput(),
      arc: { actLabel: "A suicide pact" }, // safety-blocked composed label
      firedBeatLabel: "They fuck it all up", // mature-blocked composed description
    });

    expect(out.minted).toBe(true);
    const row = tables.mementos[0]!;
    // composed label blocked → neutral "Act II of <title>" fallback, no blocked term
    expect(row.label).toBe("Act II of Tide of Ash");
    expect(row.label.toLowerCase()).not.toContain("suicide");
    // composed description blocked → fixed book-voice fallback line
    expect(row.description).not.toContain("fuck");
    expect(row.description.length).toBeGreaterThan(0);
  });

  it("swallows a thrown db error — never throws out of itself (R1.5)", async () => {
    const throwingCtx = {
      db: {
        query() {
          throw new Error("table missing");
        },
        async insert() {
          throw new Error("unreachable");
        },
      },
    };
    const out = await mintActMementoIfDue(throwingCtx as any, baseInput());
    expect(out).toEqual({ minted: false });
  });
});
