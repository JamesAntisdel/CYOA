// Tests for the story-bible generation pipeline (convex/llm/storyBible.ts,
// tasks SB-S2). Mirrors the summarizer test harness:
//   1. Pure helpers — buildStoryBiblePrompt / buildStoryBibleRefreshPrompt /
//      extractBibleJson / sanitizeBibleStrings / foldRegistryEvents /
//      readStoryBible.
//   2. generateStoryBible action against a hand-built ctx mock (fetch
//      stubbed): ready path, retry-once (R1.4), unsalvageable → failed,
//      policy neutralization (R2.3). Internal mutations are inline-executed
//      by the mock's runMutation, keyed on the full "llm/storyBible:…" path
//      (SB3) so the scheduler ref strings are pinned too.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RegistryEvent, StoryBible } from "@cyoa/engine";

import {
  BIBLE_MAX_RETRIES,
  _applyBibleRefresh,
  _markStoryBibleFailed,
  _markStoryBibleGenerating,
  _markStoryBibleRetry,
  _setStoryBible,
  buildStoryBiblePrompt,
  buildStoryBibleRefreshPrompt,
  extractBibleJson,
  foldRegistryEvents,
  generateStoryBible,
  readStoryBible,
  refreshStoryBible,
  sanitizeBibleStrings,
} from "../llm/storyBible";

function bibleFixture(overrides: Partial<StoryBible> = {}): StoryBible {
  return {
    keyRegistry: [
      { id: "bone-key", label: "the Bone Key", opensHint: "opens the crypt gate", surfaceBand: "early", status: "planned" },
      { id: "ferry-token", label: "a ferryman's token", opensHint: "passage across", surfaceBand: "mid", status: "planned" },
      { id: "salt-lamp", label: "a salt lamp", opensHint: "lights the under-stair", surfaceBand: "mid", status: "planned" },
      { id: "iron-writ", label: "the Iron Writ", opensHint: "commands the gate guard", surfaceBand: "late", status: "planned" },
    ],
    lockPlan: [
      { id: "crypt-gate", label: "the crypt gate", keyId: "bone-key", gateBand: "mid", note: "under the chapel", status: "planned" },
    ],
    cast: [
      { id: "mira", label: "Mira, ferrywoman", want: "passage north", secret: "deserted the Iron Court", bondHint: "pay her fare honestly", appearance: "weathered woman, oilskin coat, grey braid" },
    ],
    twists: [
      { id: "drowned-bell", label: "the Drowned Bell", precondition: "reader trusts the ferryman", status: "pending" },
    ],
    endingHints: [{ endingId: "the-salt-throne", requires: "hold the Iron Writ" }],
    motifs: ["salt", "bells underwater"],
    source: "llm",
    version: 1,
    ...overrides,
  };
}

describe("buildStoryBiblePrompt", () => {
  it("pins the canonical format: title, tone, premise, every section, JSON-only rule", () => {
    const prompt = buildStoryBiblePrompt({
      premise: "A radio operator on a derelict satellite hears a voice.",
      storyTitle: "Orbital Seven",
      storyTone: "melancholy sci-fi",
    });
    expect(prompt).toContain('an interactive story called "Orbital Seven"');
    expect(prompt).toContain("Tone: melancholy sci-fi.");
    expect(prompt).toContain('Story premise: """A radio operator on a derelict satellite hears a voice."""');
    expect(prompt).toContain('"keyRegistry": 6-12 entries');
    expect(prompt).toContain('"lockPlan": 2-5 entries');
    expect(prompt).toContain('"cast": 2-5 entries');
    expect(prompt).toContain('"twists": 2-4 entries');
    // Character-consistency §1/§2: the model must fix a protagonist identity
    // and give each cast member a visible appearance descriptor.
    expect(prompt).toContain('"protagonist"');
    expect(prompt).toContain("ONE person the reader plays");
    expect(prompt).toContain("it must NEVER change over the whole story");
    expect(prompt).toContain('"appearance": string (≤120, what the reader SEES');
    expect(prompt).toContain('"endingHints": 2-4 entries');
    expect(prompt).toContain('"motifs": 3-6 strings');
    expect(prompt).toContain("Output ONLY the JSON object");
    // Bands must be pinned so lockPlan validation upstream has meaning.
    expect(prompt).toContain('"surfaceBand": "early" | "mid" | "late"');
    expect(prompt).toContain('"gateBand": "mid" | "late"');
  });

  it("falls back gracefully when premise/title are empty and tone is absent", () => {
    const prompt = buildStoryBiblePrompt({ premise: "", storyTitle: "" });
    expect(prompt).toContain("(no explicit premise");
    expect(prompt).toContain("an untitled interactive story");
    expect(prompt).not.toContain("Tone:");
  });
});

describe("buildStoryBibleRefreshPrompt", () => {
  it("carries the current plan with consumption state, the summary, and the merge rules", () => {
    const bible = bibleFixture();
    bible.keyRegistry[0]!.status = "granted";
    const prompt = buildStoryBibleRefreshPrompt({
      premise: "A city under a frozen sea.",
      storySummary: "LOCATION: the ferry dock.",
      act: 2,
      bible,
    });
    expect(prompt).toContain("act 2");
    expect(prompt).toContain("LOCATION: the ferry dock.");
    expect(prompt).toContain('"id":"bone-key"');
    expect(prompt).toContain('"status":"granted"');
    expect(prompt).toContain("AT MOST 2 new keyRegistry entries");
    expect(prompt).toContain("Output ONLY the JSON object");
  });
});

describe("extractBibleJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractBibleJson('{"keyRegistry":[]}')).toEqual({ keyRegistry: [] });
  });

  it("strips markdown fences and preamble/trailing prose", () => {
    expect(extractBibleJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractBibleJson('Here is the plan:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it("returns null (never throws) on garbage", () => {
    expect(extractBibleJson("")).toBeNull();
    expect(extractBibleJson("no braces here")).toBeNull();
    expect(extractBibleJson("{ definitely not json ]")).toBeNull();
  });
});

describe("sanitizeBibleStrings (R2.3)", () => {
  it("neutralizes policy-blocked strings without failing, and falls labels back to ids", () => {
    const bible = bibleFixture();
    bible.keyRegistry[0]!.opensHint = "there is no hope beyond this door";
    bible.cast[0]!.secret = "she plans to kill myself"; // safety pattern
    bible.twists[0]!.label = "nothing matters at the bell"; // blocked label → id fallback
    bible.motifs = ["salt", "hopeless forever"];
    const out = sanitizeBibleStrings(bible);
    expect(out.keyRegistry[0]?.opensHint).toBe("");
    expect(out.cast[0]?.secret).toBe("");
    expect(out.twists[0]?.label).toBe("drowned-bell");
    expect(out.motifs).toEqual(["salt"]);
    // Clean strings pass through untouched; the input is not mutated.
    expect(out.keyRegistry[1]?.opensHint).toBe("passage across");
    expect(bible.keyRegistry[0]?.opensHint).toBe("there is no hope beyond this door");
  });
});

describe("readStoryBible", () => {
  it("reads back a persisted bible and defaults missing sections", () => {
    const read = readStoryBible({ keyRegistry: bibleFixture().keyRegistry });
    expect(read).not.toBeNull();
    expect(read?.lockPlan).toEqual([]);
    expect(read?.motifs).toEqual([]);
  });

  it("returns null for anything that doesn't minimally look like a bible", () => {
    expect(readStoryBible(null)).toBeNull();
    expect(readStoryBible("x")).toBeNull();
    expect(readStoryBible({ keyRegistry: "nope" })).toBeNull();
  });

  // Regression (character-consistency §1): readStoryBible runs on BOTH the
  // write path (_setStoryBible) and every turn's read-back. It must carry the
  // protagonist identity through — dropping it here silently strips the whole
  // prose+image drift fix even when the model emitted a valid protagonist.
  it("round-trips the protagonist identity (and cast appearance)", () => {
    const protagonist = {
      name: "Elara Vance",
      gender: "Female",
      pronouns: "she/her",
      appearance: ["auburn hair", "ink-stained hands", "navigator's coat"],
      voice: "quiet, frantic precision",
    };
    const read = readStoryBible(bibleFixture({ protagonist }));
    expect(read?.protagonist).toEqual(protagonist);
    // Cast appearance (the image path's NPC descriptor) must survive too.
    expect(read?.cast[0]?.appearance).toBe("weathered woman, oilskin coat, grey braid");
  });

  it("omits protagonist when the stored row has none (legacy-tolerant)", () => {
    const legacy = bibleFixture();
    delete (legacy as { protagonist?: unknown }).protagonist;
    const read = readStoryBible(legacy);
    expect(read).not.toBeNull();
    expect(read?.protagonist).toBeUndefined();
  });
});

describe("foldRegistryEvents (SB4)", () => {
  it("applies promise / adopt / granted / seeded / door_opened and ignores phantom_unlock", () => {
    const bible = bibleFixture();
    const events: RegistryEvent[] = [
      { kind: "promise", keyId: "bone-key", turn: 4 },
      {
        kind: "adopt",
        key: {
          id: "night-pass",
          label: "Night Pass",
          opensHint: "",
          surfaceBand: "mid",
          status: "promised",
          promisedAtTurn: 4,
          adopted: true,
        },
        turn: 4,
      },
      { kind: "granted", keyId: "ferry-token", turn: 4 },
      { kind: "seeded", keyId: "salt-lamp", turn: 4 },
      { kind: "door_opened", doorId: "crypt-gate", turn: 4 },
      { kind: "phantom_unlock", itemId: "ghost-key", choiceId: "c1", turn: 4 },
    ];
    const folded = foldRegistryEvents(bible, events);
    expect(folded.keyRegistry.find((k) => k.id === "bone-key")).toMatchObject({
      status: "promised",
      promisedAtTurn: 4,
    });
    expect(folded.keyRegistry.find((k) => k.id === "night-pass")).toMatchObject({
      adopted: true,
      status: "promised",
    });
    expect(folded.keyRegistry.find((k) => k.id === "ferry-token")).toMatchObject({
      status: "granted",
      grantedAtTurn: 4,
    });
    expect(folded.keyRegistry.find((k) => k.id === "salt-lamp")?.seeded).toBe(true);
    expect(folded.lockPlan[0]?.status).toBe("opened");
    // Input untouched (pure).
    expect(bible.keyRegistry.find((k) => k.id === "bone-key")?.status).toBe("planned");
    expect(bible.lockPlan[0]?.status).toBe("planned");
  });

  it("is idempotent-safe: granted keys stay granted at their first grant turn", () => {
    const bible = bibleFixture();
    const once = foldRegistryEvents(bible, [{ kind: "granted", keyId: "bone-key", turn: 3 }]);
    const twice = foldRegistryEvents(once, [{ kind: "granted", keyId: "bone-key", turn: 5 }]);
    expect(twice.keyRegistry.find((k) => k.id === "bone-key")?.grantedAtTurn).toBe(3);
  });

  it("returns the same bible object when there are no events", () => {
    const bible = bibleFixture();
    expect(foldRegistryEvents(bible, [])).toBe(bible);
  });

  it("folds twist_fired: flips a pending twist to fired (so the digest stops nagging)", () => {
    const bible = bibleFixture();
    const folded = foldRegistryEvents(bible, [
      { kind: "twist_fired", twistId: "drowned-bell", turn: 6 },
    ]);
    expect(folded.twists.find((t) => t.id === "drowned-bell")?.status).toBe("fired");
    // Input untouched (pure).
    expect(bible.twists.find((t) => t.id === "drowned-bell")?.status).toBe("pending");
  });

  it("folds twist_fired idempotently and ignores an unknown twist id", () => {
    const bible = bibleFixture();
    const once = foldRegistryEvents(bible, [
      { kind: "twist_fired", twistId: "drowned-bell", turn: 6 },
    ]);
    const again = foldRegistryEvents(once, [
      { kind: "twist_fired", twistId: "drowned-bell", turn: 9 },
      { kind: "twist_fired", twistId: "no-such-twist", turn: 9 },
    ]);
    expect(again.twists.filter((t) => t.status === "fired")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// generateStoryBible action — mock ctx with inline internal-mutation dispatch.
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "FIREWORKS_API_KEY",
  "FIREWORKS_BASE_URL",
  "FIREWORKS_MODEL_CHEAP",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

function envSnapshot(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]] as const));
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Route full-path internal-mutation refs to their handlers (pins SB3 strings). */
const INTERNAL_HANDLERS: Record<string, any> = {
  "llm/storyBible:_markStoryBibleGenerating": _markStoryBibleGenerating,
  "llm/storyBible:_setStoryBible": _setStoryBible,
  "llm/storyBible:_markStoryBibleRetry": _markStoryBibleRetry,
  "llm/storyBible:_markStoryBibleFailed": _markStoryBibleFailed,
  "llm/storyBible:_applyBibleRefresh": _applyBibleRefresh,
};

function makeMockCtx() {
  const row: Record<string, unknown> = {
    _id: "bible_1",
    saveId: "save_1",
    status: "queued",
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const saveDoc = { _id: "save_1", storyId: "open-canvas" };
  const inserted: Array<{ table: string; doc: any }> = [];
  const scheduled: Array<{ ref: string; args: any }> = [];
  const ctx: any = {
    db: {
      async get(id: string) {
        return id === "save_1" ? saveDoc : null;
      },
      query(_table: string) {
        const chain = {
          withIndex: () => chain,
          filter: () => chain,
          async first() {
            return row;
          },
          async collect() {
            return [row];
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        inserted.push({ table, doc });
        return `${table}_1`;
      },
      async patch(_id: string, patch: any) {
        Object.assign(row, patch);
      },
    },
    runMutation: async (ref: any, args: any) => {
      const handler = INTERNAL_HANDLERS[String(ref)];
      if (!handler) throw new Error(`unknown mutation ref: ${String(ref)}`);
      return await (handler as any)._handler(ctx, args);
    },
    scheduler: {
      async runAfter(_ms: number, ref: any, args: any) {
        scheduled.push({ ref: String(ref), args });
      },
    },
  };
  return { ctx, row, inserted, scheduled };
}

function stubFetchWithBible(payload: unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const GOOD_PAYLOAD = {
  keyRegistry: [
    { id: "bone-key", label: "the Bone Key", opensHint: "opens the crypt gate", surfaceBand: "early" },
    { id: "ferry-token", label: "a ferryman's token", opensHint: "passage across", surfaceBand: "mid" },
    { id: "salt-lamp", label: "a salt lamp", opensHint: "lights the under-stair", surfaceBand: "mid" },
    { id: "iron-writ", label: "the Iron Writ", opensHint: "no hope beyond the guard", surfaceBand: "late" },
  ],
  lockPlan: [{ id: "crypt-gate", label: "the crypt gate", keyId: "bone-key", gateBand: "mid", note: "" }],
  cast: [{ id: "mira", label: "Mira", want: "passage north", secret: "deserted", bondHint: "" }],
  twists: [{ id: "drowned-bell", label: "the Drowned Bell", precondition: "trust the ferryman" }],
  endingHints: [{ endingId: "salt-throne", requires: "hold the writ" }],
  motifs: ["salt", "bells"],
};

describe("generateStoryBible action", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = envSnapshot();
    delete process.env.FIREWORKS_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  const baseArgs = {
    saveId: "save_1",
    accountId: "acct_1",
    premise: "A city under a frozen sea.",
    storyTitle: "Beneath",
    attempt: 0,
  };

  it("persists a validated + sanitized bible via _setStoryBible and fires bible.generated", async () => {
    process.env.FIREWORKS_API_KEY = "test-key";
    const restoreFetch = stubFetchWithBible(GOOD_PAYLOAD);
    try {
      const { ctx, row, inserted } = makeMockCtx();
      const result = await (generateStoryBible as any)._handler(ctx, baseArgs);
      expect(result).toMatchObject({ generated: true, keys: 4 });
      expect(row.status).toBe("ready");
      const bible = row.bible as StoryBible;
      expect(bible.keyRegistry).toHaveLength(4);
      // R2.3 neutralization ran between validation and persistence.
      expect(bible.keyRegistry.find((k) => k.id === "iron-writ")?.opensHint).toBe("");
      expect(bible.keyRegistry.find((k) => k.id === "bone-key")?.opensHint).toBe(
        "opens the crypt gate",
      );
      // Analytics: bible.generated with keys/doors/retried payload.
      const event = inserted.find((i) => i.table === "analytics_events");
      expect(event?.doc.eventName).toBe("bible.generated");
      expect(event?.doc.payload).toMatchObject({ keys: 4, doors: 1, retried: false });
    } finally {
      restoreFetch();
    }
  });

  it("retries exactly once when no provider is configured (R1.4)", async () => {
    const { ctx, row, scheduled } = makeMockCtx();
    const result = await (generateStoryBible as any)._handler(ctx, baseArgs);
    expect(result).toMatchObject({ generated: false, retried: true });
    expect(row.status).toBe("queued");
    expect(row.retryCount).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.ref).toBe("llm/storyBible:generateStoryBible");
    expect(scheduled[0]?.args.attempt).toBe(1);
  });

  it("marks the row failed after the final attempt — save plays bible-less forever", async () => {
    const { ctx, row, scheduled } = makeMockCtx();
    const result = await (generateStoryBible as any)._handler(ctx, {
      ...baseArgs,
      attempt: BIBLE_MAX_RETRIES,
    });
    expect(result).toMatchObject({ generated: false, retried: false });
    expect(row.status).toBe("failed");
    expect(scheduled).toHaveLength(0);
  });

  it("treats an unsalvageable payload (under 4 keys) as a failure, not a crash", async () => {
    process.env.FIREWORKS_API_KEY = "test-key";
    const restoreFetch = stubFetchWithBible({
      keyRegistry: [{ id: "only-key", label: "Only Key", opensHint: "", surfaceBand: "early" }],
    });
    try {
      const { ctx, row } = makeMockCtx();
      const result = await (generateStoryBible as any)._handler(ctx, {
        ...baseArgs,
        attempt: BIBLE_MAX_RETRIES,
      });
      expect(result).toMatchObject({ generated: false, reason: "unsalvageable" });
      expect(row.status).toBe("failed");
    } finally {
      restoreFetch();
    }
  });

  it("never throws even when the mutation surface itself throws", async () => {
    const { ctx } = makeMockCtx();
    ctx.runMutation = async () => {
      throw new Error("convex_unavailable");
    };
    const result = await (generateStoryBible as any)._handler(ctx, baseArgs);
    expect(result).toMatchObject({ generated: false });
  });

  it("does not clobber an already-ready row (duplicate action run)", async () => {
    process.env.FIREWORKS_API_KEY = "test-key";
    const restoreFetch = stubFetchWithBible(GOOD_PAYLOAD);
    try {
      const { ctx, row } = makeMockCtx();
      row.status = "ready";
      row.bible = bibleFixture({ motifs: ["original"] });
      await (generateStoryBible as any)._handler(ctx, baseArgs);
      expect((row.bible as StoryBible).motifs).toEqual(["original"]);
    } finally {
      restoreFetch();
    }
  });
});

describe("refreshStoryBible action + _applyBibleRefresh (R6)", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = envSnapshot();
    delete process.env.FIREWORKS_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("merges against the row's CURRENT bible and fires bible.refreshed", async () => {
    process.env.FIREWORKS_API_KEY = "test-key";
    // Refresh proposal: keeps every current key (same ids), adds one new key.
    const restoreFetch = stubFetchWithBible({
      ...GOOD_PAYLOAD,
      keyRegistry: [
        ...GOOD_PAYLOAD.keyRegistry,
        { id: "new-sigil", label: "a new sigil", opensHint: "marks the door", surfaceBand: "late" },
      ],
    });
    try {
      const { ctx, row, inserted } = makeMockCtx();
      row.status = "ready";
      row.bible = bibleFixture();
      const result = await (refreshStoryBible as any)._handler(ctx, {
        saveId: "save_1",
        accountId: "acct_1",
        act: 2,
        premise: "A city under a frozen sea.",
        storySummary: "LOCATION: the dock.",
        bible: row.bible,
      });
      expect(result).toMatchObject({ refreshed: true });
      const merged = row.bible as StoryBible;
      expect(merged.keyRegistry.some((k) => k.id === "new-sigil")).toBe(true);
      const event = inserted.find(
        (i) => i.table === "analytics_events" && i.doc.eventName === "bible.refreshed",
      );
      expect(event?.doc.payload).toMatchObject({ act: 2, added: 1 });
    } finally {
      restoreFetch();
    }
  });

  it("keeps the current bible silently when no provider is configured", async () => {
    const { ctx, row } = makeMockCtx();
    row.status = "ready";
    row.bible = bibleFixture();
    const before = JSON.stringify(row.bible);
    const result = await (refreshStoryBible as any)._handler(ctx, {
      saveId: "save_1",
      accountId: "acct_1",
      act: 2,
      premise: "x",
      storySummary: "",
      bible: row.bible,
    });
    expect(result).toMatchObject({ refreshed: false });
    expect(JSON.stringify(row.bible)).toBe(before);
  });
});
