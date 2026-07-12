/**
 * Community seed shelf client (creator-arc; core-read-loop Req 22.3/22.6,
 * steering product feature 13 — creator seeds + discovery library).
 *
 * Mirrors the per-feature `*Api.ts` pattern (`creatorDashboardApi.ts`): a thin
 * typed wrapper over the canonical `convexHttp` transport plus the BC2
 * null-mapping adapter the Discover route renders from.
 *
 * BUILD CORRECTIONS honored:
 *  - BC1: full registered convex paths (`creatorFunctions:listPublishedPublic`).
 *  - BC2: the server emits null-for-absent (`synopsis`, `tone`,
 *    `remixOfTitle`); the adapter maps nulls to optional client fields and
 *    tolerates partial/garbage payloads by dropping rows, never throwing.
 *  - BC4: `exactOptionalPropertyTypes` — optional keys via conditional spread.
 *
 * Pure helpers import nothing from React Native so they run under vitest
 * (`lib/__tests__/seedShelfApi.test.ts`).
 */
import { convexHttp } from "./convexHttp";

// ---------------------------------------------------------------------------
// Wire shapes — adapted client types first, then the raw server shapes.
// ---------------------------------------------------------------------------

export type CommunitySeedForkPolicy = "allowed" | "disabled";

export type CommunitySeed = {
  seedId: string;
  /** `authored_seed:<seedId>` — pass straight to the createSave launch path. */
  storyId: string;
  title: string;
  synopsis?: string;
  tone?: string;
  /** The seed's opening prose (turn-0 content only — BC10). */
  opening: string;
  /** Deterministic creator pseudonym; never the raw account id. */
  ownerHandle: string;
  isMature: boolean;
  forkPolicy: CommunitySeedForkPolicy;
  /** Credit line when this seed is itself a remix. */
  remixOfTitle?: string;
  publishedAt: number;
};

export type CommunitySeedPage = {
  seeds: CommunitySeed[];
  /** Pass back as `cursor` to fetch the next (older) page; null = end. */
  nextCursor: number | null;
};

type ServerSeed = {
  seedId: string;
  storyId: string;
  title: string;
  synopsis: string | null;
  tone: string | null;
  opening: string;
  ownerHandle: string;
  isMature: boolean;
  forkPolicy: CommunitySeedForkPolicy;
  remixOfTitle: string | null;
  publishedAt: number;
};

type ServerPage = { seeds: ServerSeed[] | null; nextCursor: number | null };

// ---------------------------------------------------------------------------
// Adapter (exported for direct unit testing — BC2 null-mapping).
// ---------------------------------------------------------------------------

/**
 * Map the raw `listPublishedPublic` payload onto the client model. Malformed
 * rows are dropped (tolerant-drop); a missing/garbage payload adapts to an
 * empty final page so the shelf renders its empty state instead of crashing.
 */
export function adaptCommunitySeedPage(raw: ServerPage | null | undefined): CommunitySeedPage {
  const rows = Array.isArray(raw?.seeds) ? raw!.seeds : [];
  const seeds: CommunitySeed[] = [];
  for (const row of rows) {
    if (!row || typeof row.seedId !== "string" || typeof row.storyId !== "string") continue;
    if (typeof row.title !== "string" || row.title.length === 0) continue;
    seeds.push({
      seedId: row.seedId,
      storyId: row.storyId,
      title: row.title,
      // null-for-absent → drop the optional key entirely (BC4).
      ...(typeof row.synopsis === "string" && row.synopsis.length > 0
        ? { synopsis: row.synopsis }
        : {}),
      ...(typeof row.tone === "string" && row.tone.length > 0 ? { tone: row.tone } : {}),
      opening: typeof row.opening === "string" ? row.opening : "",
      ownerHandle: typeof row.ownerHandle === "string" ? row.ownerHandle : "a keeper",
      isMature: row.isMature === true,
      forkPolicy: row.forkPolicy === "disabled" ? "disabled" : "allowed",
      ...(typeof row.remixOfTitle === "string" && row.remixOfTitle.length > 0
        ? { remixOfTitle: row.remixOfTitle }
        : {}),
      publishedAt:
        typeof row.publishedAt === "number" && Number.isFinite(row.publishedAt)
          ? row.publishedAt
          : 0,
    });
  }
  const nextCursor =
    typeof raw?.nextCursor === "number" && Number.isFinite(raw.nextCursor)
      ? raw.nextCursor
      : null;
  return { seeds, nextCursor };
}

// ---------------------------------------------------------------------------
// Transport (BC1 full paths — pinned by lib/__tests__/seedShelfApi.test.ts).
// ---------------------------------------------------------------------------

export const SEED_SHELF_PATHS = {
  listPublishedPublic: "creatorFunctions:listPublishedPublic",
  remix: "creatorFunctions:remix",
} as const;

/**
 * Fetch one page of the public community shelf. `accountId` is optional —
 * guests browse anonymously (and never see mature seeds, Req 12.9). Returns
 * `null` on transport failure so the route can render a retry state.
 */
export async function listRemoteCommunitySeeds(input: {
  accountId?: string;
  guestTokenHash?: string;
  cursor?: number;
  limit?: number;
}): Promise<CommunitySeedPage | null> {
  const result = await convexHttp<ServerPage>(
    "query",
    SEED_SHELF_PATHS.listPublishedPublic,
    input as unknown as Record<string, unknown>,
  );
  if (result === null) return null;
  return adaptCommunitySeedPage(result);
}

/**
 * Remix a public seed into a new draft on the caller's shelf, credited to the
 * source. Server refusals (`creator_seed_remix_disabled`,
 * `creator_seed_mature_forbidden`, …) surface as `null` through the shared
 * transport — the route shows a generic "remix unavailable" toast.
 */
export async function remixRemoteSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
}): Promise<{ seedId: string } | null> {
  const result = await convexHttp<{ seedId: string }>(
    "mutation",
    SEED_SHELF_PATHS.remix,
    input as unknown as Record<string, unknown>,
  );
  if (!result || typeof result.seedId !== "string") return null;
  return { seedId: result.seedId };
}
