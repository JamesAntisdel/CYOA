import { describe, expect, it } from "vitest";

import type { NpcRole, NpcState } from "@cyoa/engine";

import {
  defaultPortraitUriForAsset,
  dispositionVibe,
  roleToneColors,
  sortNpcsForRoster,
} from "../NpcRoster.helpers";

// Vitest config for apps/app sets `environment: "node"` (see
// apps/app/vitest.config.ts) — no React Native renderer is configured here,
// so component-level snapshot tests would require pulling in a new dep tree.
// Following the existing pattern in this directory (types.test.ts,
// StatPip.test.ts) we cover the pure helpers exported by NpcRoster instead.

function makeNpc(
  id: string,
  overrides: Partial<NpcState> & Pick<NpcState, "name" | "role">,
): NpcState {
  return {
    id,
    name: overrides.name,
    role: overrides.role,
    disposition: overrides.disposition ?? 0,
    attributes: overrides.attributes ?? {},
    knownFacts: overrides.knownFacts ?? [],
    flags: overrides.flags ?? {},
    ...(overrides.location ? { location: overrides.location } : {}),
    ...(overrides.inventory ? { inventory: overrides.inventory } : {}),
    ...(overrides.relationships ? { relationships: overrides.relationships } : {}),
    ...(overrides.portraitAssetId ? { portraitAssetId: overrides.portraitAssetId } : {}),
  };
}

describe("dispositionVibe", () => {
  it("maps the five canonical vibe windows", () => {
    expect(dispositionVibe(75)).toBe("friendly"); // >= 50
    expect(dispositionVibe(50)).toBe("friendly"); // inclusive boundary
    expect(dispositionVibe(49)).toBe("warm"); // >= 10
    expect(dispositionVibe(10)).toBe("warm"); // inclusive boundary
    expect(dispositionVibe(0)).toBe("neutral");
    expect(dispositionVibe(-10)).toBe("neutral"); // inclusive lower bound
    expect(dispositionVibe(-11)).toBe("wary");
    expect(dispositionVibe(-50)).toBe("wary"); // inclusive lower bound
    expect(dispositionVibe(-51)).toBe("hostile");
    expect(dispositionVibe(-100)).toBe("hostile");
  });

  it("clamps the extreme ends", () => {
    expect(dispositionVibe(100)).toBe("friendly");
    expect(dispositionVibe(-100)).toBe("hostile");
  });
});

describe("sortNpcsForRoster", () => {
  const roster: Record<string, NpcState> = {
    a: makeNpc("a", { name: "Rook", role: "rival" }),
    b: makeNpc("b", { name: "Briar", role: "companion" }),
    c: makeNpc("c", { name: "Lume", role: "ally" }),
    d: makeNpc("d", { name: "Husk", role: "antagonist" }),
    e: makeNpc("e", { name: "Step", role: "neutral" }),
    f: makeNpc("f", { name: "Aron", role: "companion" }),
  };

  it("sorts roles companion → ally → neutral → rival → antagonist", () => {
    const ordered = sortNpcsForRoster(roster);
    expect(ordered.map((n) => n.role)).toEqual([
      "companion",
      "companion",
      "ally",
      "neutral",
      "rival",
      "antagonist",
    ]);
  });

  it("stable-sorts within a role bucket by name", () => {
    const ordered = sortNpcsForRoster(roster);
    const companions = ordered.filter((n) => n.role === "companion");
    expect(companions.map((n) => n.name)).toEqual(["Aron", "Briar"]);
  });

  it("returns an empty array for an empty roster (rendered as nothing)", () => {
    expect(sortNpcsForRoster({})).toEqual([]);
  });

  it("returns a single-element array for one NPC", () => {
    const single = sortNpcsForRoster({
      x: makeNpc("x", { name: "Solo", role: "companion" }),
    });
    expect(single).toHaveLength(1);
    expect(single[0]?.name).toBe("Solo");
  });

  it("handles a five-role mix end-to-end (snapshot-equivalent ordering)", () => {
    const mixed: Record<string, NpcState> = {
      r1: makeNpc("r1", { name: "Crow", role: "rival", disposition: -25 }),
      r2: makeNpc("r2", { name: "Vex", role: "antagonist", disposition: -75 }),
      r3: makeNpc("r3", { name: "Mira", role: "ally", disposition: 30 }),
      r4: makeNpc("r4", { name: "Tarn", role: "companion", disposition: 60 }),
      r5: makeNpc("r5", { name: "Eel", role: "neutral", disposition: 0 }),
    };
    const ordered = sortNpcsForRoster(mixed);
    expect(ordered.map((n) => `${n.role}:${n.name}`)).toEqual([
      "companion:Tarn",
      "ally:Mira",
      "neutral:Eel",
      "rival:Crow",
      "antagonist:Vex",
    ]);
  });
});

describe("roleToneColors", () => {
  const palette = {
    accent: "#ACCENT",
    accentMuted: "#ACCENTMUTED",
    danger: "#DANGER",
    surface: "#SURFACE",
    border: "#BORDER",
    borderMuted: "#BORDERMUTED",
  };

  it("returns a tone for every NpcRole (exhaustive)", () => {
    const roles: NpcRole[] = ["companion", "ally", "rival", "neutral", "antagonist"];
    for (const role of roles) {
      const tone = roleToneColors(role, palette);
      expect(tone.background).toBeTruthy();
      expect(tone.border).toBeTruthy();
    }
  });

  it("uses the danger color for antagonist (full error hue)", () => {
    const tone = roleToneColors("antagonist", palette);
    expect(tone.background).toBe(palette.danger);
    expect(tone.border).toBe(palette.danger);
  });

  it("uses the accent color for companion (warm primary)", () => {
    const tone = roleToneColors("companion", palette);
    expect(tone.background).toBe(palette.accent);
  });

  it("uses the muted-border treatment for neutral (recessive)", () => {
    const tone = roleToneColors("neutral", palette);
    expect(tone.border).toBe(palette.borderMuted);
  });
});

describe("defaultPortraitUriForAsset", () => {
  it("returns undefined so the card falls back to the initials placeholder", () => {
    // Previously returned a `/api/portrait/<id>` stub that didn't resolve.
    // Real portraits come from the convex `getNpcPortraitUrl` query via
    // `useNpcPortraitUrl`; the default fallback now just opts out of <Image>.
    expect(defaultPortraitUriForAsset("abc-123")).toBeUndefined();
  });
});
