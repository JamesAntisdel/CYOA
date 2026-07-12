// Community seed shelf client (creator-arc): BC1 path pinning + the BC2
// null-mapping adapter the Discover route renders from.

import { describe, expect, it } from "vitest";

import { adaptCommunitySeedPage, SEED_SHELF_PATHS } from "../seedShelfApi";

function serverSeed(overrides: Record<string, unknown> = {}) {
  return {
    seedId: "seed1",
    storyId: "authored_seed:seed1",
    title: "Public One",
    synopsis: "A short synopsis.",
    tone: "gothic-mystery",
    opening: "A clean opening.",
    ownerHandle: "ashen-lantern-3f2a",
    isMature: false,
    forkPolicy: "allowed",
    remixOfTitle: null,
    publishedAt: 100,
    ...overrides,
  };
}

describe("seedShelfApi — BC1 full convex paths", () => {
  it("pins the registered function paths including the module prefix", () => {
    expect(SEED_SHELF_PATHS.listPublishedPublic).toBe("creatorFunctions:listPublishedPublic");
    expect(SEED_SHELF_PATHS.remix).toBe("creatorFunctions:remix");
  });
});

describe("seedShelfApi — adaptCommunitySeedPage (BC2 null-mapping)", () => {
  it("maps null-for-absent server fields to dropped optional keys", () => {
    const page = adaptCommunitySeedPage({
      seeds: [serverSeed({ synopsis: null, tone: null, remixOfTitle: "Original" }) as any],
      nextCursor: 55,
    });
    expect(page.seeds).toHaveLength(1);
    const seed = page.seeds[0]!;
    expect("synopsis" in seed).toBe(false);
    expect("tone" in seed).toBe(false);
    expect(seed.remixOfTitle).toBe("Original");
    expect(seed.forkPolicy).toBe("allowed");
    expect(page.nextCursor).toBe(55);
  });

  it("drops malformed rows and tolerates a garbage payload", () => {
    const page = adaptCommunitySeedPage({
      seeds: [
        serverSeed() as any,
        null as any,
        { seedId: 42 } as any,
        serverSeed({ seedId: "seed2", title: "" }) as any,
      ],
      nextCursor: null,
    });
    expect(page.seeds.map((seed) => seed.seedId)).toEqual(["seed1"]);
    expect(adaptCommunitySeedPage(null)).toEqual({ seeds: [], nextCursor: null });
    expect(adaptCommunitySeedPage({ seeds: null, nextCursor: null })).toEqual({
      seeds: [],
      nextCursor: null,
    });
  });

  it("coerces unknown forkPolicy values to the safe 'allowed' default and bad numbers to 0", () => {
    const page = adaptCommunitySeedPage({
      seeds: [serverSeed({ forkPolicy: "weird", publishedAt: Number.NaN }) as any],
      nextCursor: Number.NaN as any,
    });
    expect(page.seeds[0]!.forkPolicy).toBe("allowed");
    expect(page.seeds[0]!.publishedAt).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it("keeps the disabled fork policy so the Remix CTA hides", () => {
    const page = adaptCommunitySeedPage({
      seeds: [serverSeed({ forkPolicy: "disabled" }) as any],
      nextCursor: null,
    });
    expect(page.seeds[0]!.forkPolicy).toBe("disabled");
  });
});
