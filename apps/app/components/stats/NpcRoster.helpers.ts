import type { NpcRole, NpcState } from "@cyoa/engine";

/**
 * Pure helpers backing `NpcRoster.tsx`. Split into a sibling file so the
 * `apps/app` vitest config (which forbids react-native imports — see
 * `apps/app/vitest.config.ts`) can unit-test sort order, vibe windows, and
 * role tone resolution without pulling in the RN runtime.
 */

/**
 * Default portrait resolver. Returns `undefined` so the roster falls back to
 * the initials placeholder when no live resolver is wired (unit tests, the
 * static design-bundle preview, etc).
 *
 * Real callers pass a `portraitResolver` prop to `NpcRoster` (or the
 * `accountId`/`saveId` pair, which makes the roster call
 * `useNpcPortraitUrl` per NPC internally). The Convex query
 * `media/npcMedia:getNpcPortraitUrl` is the source of truth; this helper
 * exists only as the no-resolver fallback path.
 *
 * NOTE: previously returned `/api/portrait/{assetId}` — that route doesn't
 * exist and the resulting URL bricked the <Image> source for any NPC with a
 * portraitAssetId. Returning `undefined` lets the card render its initials
 * placeholder, which is what the design intends in the no-resolver case.
 */
export function defaultPortraitUriForAsset(_assetId: string): string | undefined {
  return undefined;
}

/**
 * Sort cards: companions first (you brought them), then allies, then neutrals
 * in the middle, then rivals, and antagonists last. Within a role bucket,
 * stable-sort by name so repeat renders don't jitter cards around.
 */
const ROLE_ORDER: Record<NpcRole, number> = {
  companion: 0,
  ally: 1,
  neutral: 2,
  rival: 3,
  antagonist: 4,
};

export function sortNpcsForRoster(npcs: Record<string, NpcState>): NpcState[] {
  return Object.values(npcs)
    .slice()
    .sort((a, b) => {
      const roleDelta = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (roleDelta !== 0) return roleDelta;
      return a.name.localeCompare(b.name);
    });
}

export type DispositionVibe = "friendly" | "warm" | "neutral" | "wary" | "hostile";

export function dispositionVibe(disposition: number): DispositionVibe {
  if (disposition >= 50) return "friendly";
  if (disposition >= 10) return "warm";
  if (disposition >= -10) return "neutral";
  if (disposition >= -50) return "wary";
  return "hostile";
}

export const ROLE_LABEL: Record<NpcRole, string> = {
  companion: "Companion",
  ally: "Ally",
  neutral: "Neutral",
  rival: "Rival",
  antagonist: "Antagonist",
};

export type RoleTone = { background: string; border: string };

/**
 * Map an NPC role onto theme-token color pairs for the role chip.
 *
 * The theme exposes a narrow palette (`accent`, `accentMuted`, `danger`,
 * `surface(Muted)`, `border(Muted)`). We map the five roles onto those tokens
 * so role hue tracks the theme (day/night/sepia) automatically:
 *
 *  - companion  → accent + border         (warm primary — "your party")
 *  - ally       → accentMuted + border    (mellow accent — friendly NPCs)
 *  - neutral    → surface + borderMuted   (recessive — neither friend nor foe)
 *  - rival      → accentMuted + danger    (warning-tinted border)
 *  - antagonist → danger + danger         (full error hue — clear hostility)
 */
export function roleToneColors(
  role: NpcRole,
  colors: {
    accent: string;
    accentMuted: string;
    danger: string;
    surface: string;
    border: string;
    borderMuted: string;
  },
): RoleTone {
  switch (role) {
    case "companion":
      return { background: colors.accent, border: colors.border };
    case "ally":
      return { background: colors.accentMuted, border: colors.border };
    case "neutral":
      return { background: colors.surface, border: colors.borderMuted };
    case "rival":
      return { background: colors.accentMuted, border: colors.danger };
    case "antagonist":
      return { background: colors.danger, border: colors.danger };
  }
}

export function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
