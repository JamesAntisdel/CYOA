import { describe, expect, it } from "vitest";

import {
  ANCHOR_MAX_ATTEMPTS,
  buildImageIdentityPrefix,
  loadReferenceBytes,
  maybeRescheduleAnchor,
  resolvePresentCast,
} from "../media/sceneMedia";

// =============================================================================
// Character consistency — image identity injection, NPC portrait references,
// and anchor retry (design 2026-07-12 §3). These are the media-owned fixes for
// frame-to-frame character drift.
// =============================================================================

const protagonist = {
  name: "Mara Vance",
  gender: "woman",
  pronouns: "she/her",
  appearance: ["auburn braid", "weathered flight jacket", "late thirties"],
  voice: "clipped, dry",
};

describe("buildImageIdentityPrefix (§3.1 fixed identity text)", () => {
  it("produces the SAME string for the same protagonist across turns", () => {
    const a = buildImageIdentityPrefix(protagonist, []);
    const b = buildImageIdentityPrefix({ ...protagonist }, []);
    expect(a).toBe(b);
    expect(a).toContain("Mara Vance");
    expect(a).toContain("woman");
    expect(a).toContain("she/her");
    expect(a).toContain("auburn braid");
    expect(a.startsWith("CHARACTERS (render exactly, do not restyle):")).toBe(true);
  });

  it("includes a matched NPC's appearance descriptor when present", () => {
    const cast = [
      { id: "npc_rell", label: "Rell", appearance: "scarred quartermaster, shaved head, burn on left cheek" },
    ];
    const prefix = buildImageIdentityPrefix(protagonist, cast);
    expect(prefix).toContain("Rell — scarred quartermaster, shaved head, burn on left cheek");
    // Protagonist stays first (face weighting).
    expect(prefix.indexOf("Mara Vance")).toBeLessThan(prefix.indexOf("Rell"));
  });

  it("returns an empty string when there is no protagonist and no cast (legacy-tolerant)", () => {
    expect(buildImageIdentityPrefix(undefined, [])).toBe("");
    expect(buildImageIdentityPrefix(null, [])).toBe("");
    expect(buildImageIdentityPrefix({ name: "" }, [])).toBe("");
    // A cast member with no appearance contributes nothing.
    expect(buildImageIdentityPrefix(undefined, [{ label: "Rell" }])).toBe("");
  });

  it("caps appearance descriptors at six and tolerates non-string entries", () => {
    const many = buildImageIdentityPrefix(
      { name: "Kai", appearance: ["a", "b", "c", "d", "e", "f", "g", 42, null] },
      [],
    );
    expect(many).toContain("a, b, c, d, e, f");
    expect(many).not.toContain(", g");
    expect(many).not.toContain("42");
  });
});

describe("resolvePresentCast (§3.2 tolerant mention match)", () => {
  const cast = [
    { id: "npc_rell", label: "Rell", appearance: "shaved head" },
    { id: "npc_sena", label: "Captain Sena", appearance: "silver epaulettes" },
    { id: "npc_ghost", label: "Ghost", appearance: "hooded" },
  ];

  it("matches by id and by label, ignoring case and separators", () => {
    expect(resolvePresentCast(cast, ["npc_rell"]).map((c) => c.id)).toEqual(["npc_rell"]);
    // Label match (mention is the display label, not the slug).
    expect(resolvePresentCast(cast, ["Captain Sena"]).map((c) => c.id)).toEqual(["npc_sena"]);
    // Normalization: separators/case don't matter.
    expect(resolvePresentCast(cast, ["NPC-RELL"]).map((c) => c.id)).toEqual(["npc_rell"]);
  });

  it("returns [] for no mentions or no match", () => {
    expect(resolvePresentCast(cast, [])).toEqual([]);
    expect(resolvePresentCast(cast, ["nobody"])).toEqual([]);
  });
});

describe("loadReferenceBytes (§3.2 protagonist + setting + NPC portraits)", () => {
  function makeCtx() {
    const assetRows: Record<string, { status: string; storageId?: string; mime?: string }> = {
      proto: { status: "ready", storageId: "s_proto", mime: "image/png" },
      setting: { status: "ready", storageId: "s_setting", mime: "image/png" },
      npcReady: { status: "ready", storageId: "s_npc", mime: "image/png" },
      npcPending: { status: "generating" }, // not ready → skipped
    };
    const blobs: Record<string, Blob> = {
      s_proto: new Blob([new Uint8Array([1, 1, 1])], { type: "image/png" }),
      s_setting: new Blob([new Uint8Array([2, 2])], { type: "image/png" }),
      s_npc: new Blob([new Uint8Array([3])], { type: "image/png" }),
    };
    return {
      runQuery: async (_name: unknown, { assetId }: { assetId: string }) => assetRows[assetId] ?? null,
      storage: { get: async (sid: string) => blobs[sid] ?? null },
    };
  }

  it("iterates protagonist, setting, then NPC portraits and skips non-ready assets", async () => {
    const ctx = makeCtx();
    const refs = await loadReferenceBytes(ctx, {
      protagonist: "proto",
      setting: "setting",
      npcs: ["npcReady", "npcPending"],
    });
    // proto (3 bytes), setting (2 bytes), npcReady (1 byte) — npcPending dropped.
    expect(refs.map((r) => r.bytes.length)).toEqual([3, 2, 1]);
  });

  it("works with only NPC references (no anchors) and drops missing rows", async () => {
    const ctx = makeCtx();
    const refs = await loadReferenceBytes(ctx, { npcs: ["npcReady", "missing"] });
    expect(refs.map((r) => r.bytes.length)).toEqual([1]);
  });
});

describe("maybeRescheduleAnchor (§3.3 bounded anchor retry)", () => {
  const args = { assetId: "a1", prompt: "portrait", saveId: "save1", kind: "protagonist" as const };

  it("reschedules with attempt+1 while under the cap and never marks failed", async () => {
    const scheduled: Array<{ delayMs: number; jobArgs: any }> = [];
    const ctx = {
      scheduler: {
        runAfter: async (delayMs: number, _name: unknown, jobArgs: any) => {
          scheduled.push({ delayMs, jobArgs });
        },
      },
    };
    // attempt 0 → schedules attempt 1
    expect(await maybeRescheduleAnchor(ctx, args, 0, "gemini_image_empty")).toBe(true);
    // attempt at the last allowed index → no more reschedule (caller marks failed)
    expect(await maybeRescheduleAnchor(ctx, args, ANCHOR_MAX_ATTEMPTS - 1, "gemini_image_empty")).toBe(false);
    expect(scheduled).toHaveLength(1);
    const first = scheduled[0];
    expect(first?.jobArgs.attempt).toBe(1);
    expect(first?.jobArgs.kind).toBe("protagonist");
  });

  it("never throws when the scheduler itself fails (BC5) — returns false so the caller marks failed", async () => {
    const ctx = {
      scheduler: {
        runAfter: async () => {
          throw new Error("scheduler_down");
        },
      },
    };
    await expect(maybeRescheduleAnchor(ctx, args, 0, "boom")).resolves.toBe(false);
  });
});
