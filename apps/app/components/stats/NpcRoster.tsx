import { Image, View } from "react-native";

import type { NpcState } from "@cyoa/engine";

import { useNpcPortraitUrl } from "../../hooks/useNpcPortrait";
import { Chip, Portrait, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import {
  capitalize,
  defaultPortraitUriForAsset,
  dispositionVibe,
  roleToneColors,
  ROLE_LABEL,
  sortNpcsForRoster,
} from "./NpcRoster.helpers";

// Re-export the pure helpers so callers (and the legacy import path) keep
// working — the unit tests at `__tests__/NpcRoster.test.ts` import directly
// from `./NpcRoster.helpers` to avoid pulling in the RN runtime under the
// node-environment vitest config (see apps/app/vitest.config.ts).
export {
  defaultPortraitUriForAsset,
  dispositionVibe,
  roleToneColors,
  sortNpcsForRoster,
} from "./NpcRoster.helpers";
export type { DispositionVibe } from "./NpcRoster.helpers";

/**
 * Cast roster surfaced on the Character Sheet (FullSheet) overlay — see
 * Requirement 31 (`PlayerState.npcs: Record<string, NpcState>`). Renders one
 * card per NPC currently in the player's state: portrait (or initial
 * placeholder), name, role badge, disposition vibe, top knownFacts, and any
 * visible NPC attributes.
 *
 * Hidden-state policy mirrors the player HUD: NPC attributes flagged
 * `visibility === "hidden"` never appear here, even if the engine retains
 * them in the save's NPC record.
 */
export type NpcRosterProps = {
  npcs: Record<string, NpcState> | undefined;
  /**
   * Optional resolver from `portraitAssetId` -> displayable URI. Lets parents
   * inject whatever the image-gen pipeline ships (a Convex storage URL, a
   * CDN-signed asset, etc). Falls back to the local stub
   * `defaultPortraitUriForAsset` when omitted.
   */
  portraitUriForAsset?: (assetId: string) => string | undefined;
  /**
   * Save/account identity. When provided, the roster auto-resolves each
   * NPC's portrait via the Convex `media/npcMedia:getNpcPortraitUrl` query
   * (see `useNpcPortraitUrl`) instead of relying on `portraitUriForAsset`.
   * Pass these together — both are required for the live lookup; omit them
   * for static previews / unit-test renders.
   */
  accountId?: string;
  saveId?: string;
};

export function NpcRoster({
  npcs,
  portraitUriForAsset,
  accountId,
  saveId,
}: NpcRosterProps) {
  const { tokens } = useAppTheme();

  // Empty-state policy — Requirement 31's surface omits the heading entirely
  // when there's no cast, so the character sheet doesn't bloom an empty
  // section on every save that never spawned an NPC.
  if (!npcs) return null;
  const ordered = sortNpcsForRoster(npcs);
  if (ordered.length === 0) return null;

  return (
    <View accessibilityLabel="Cast roster" style={{ gap: tokens.spacing.sm }}>
      {ordered.map((npc) => {
        // Two render paths share the same card:
        //   - live lookup: accountId + saveId provided → call the convex
        //     query through a per-NPC wrapper component (hooks rule: one
        //     hook per component instance, mounted in stable order keyed
        //     by npc.id).
        //   - static path: caller passed `portraitUriForAsset` or nothing
        //     → resolve synchronously and render the static card.
        if (accountId && saveId && npc.portraitAssetId) {
          return (
            <NpcRosterCardLive
              key={npc.id}
              accountId={accountId}
              saveId={saveId}
              npc={npc}
            />
          );
        }
        return (
          <NpcRosterCard
            key={npc.id}
            npc={npc}
            portraitUri={
              npc.portraitAssetId
                ? (portraitUriForAsset ?? defaultPortraitUriForAsset)(npc.portraitAssetId)
                : undefined
            }
          />
        );
      })}
    </View>
  );
}

/**
 * Per-NPC wrapper that calls the convex query hook. Splitting it out keeps
 * the hook call rule-of-hooks-safe: each instance owns exactly one hook
 * call, and React mounts/unmounts them by the `key={npc.id}` above as the
 * cast roster changes.
 */
function NpcRosterCardLive({
  accountId,
  saveId,
  npc,
}: {
  accountId: string;
  saveId: string;
  npc: NpcState;
}) {
  const url = useNpcPortraitUrl({ accountId, saveId, npcId: npc.id });
  return <NpcRosterCard npc={npc} portraitUri={url ?? undefined} />;
}

type NpcRosterCardProps = {
  npc: NpcState;
  portraitUri: string | undefined;
};

function NpcRosterCard({ npc, portraitUri }: NpcRosterCardProps) {
  const { tokens } = useAppTheme();
  const portraitSize = 48;
  const vibe = dispositionVibe(npc.disposition);
  const visibleAttributes = Object.values(npc.attributes ?? {}).filter(
    (attr) => attr.visibility === "visible",
  );
  const topFacts = (npc.knownFacts ?? []).slice(0, 2);
  const roleTone = roleToneColors(npc.role, tokens.colors);

  return (
    <Surface
      accessibilityLabel={`${npc.name} — ${ROLE_LABEL[npc.role]}`}
      padded
      style={{
        gap: tokens.spacing.sm,
      }}
      variant="muted"
    >
      <View style={{ flexDirection: "row", gap: tokens.spacing.md }}>
        {portraitUri ? (
          <Image
            accessibilityLabel={`${npc.name} portrait`}
            source={{ uri: portraitUri }}
            style={{
              backgroundColor: tokens.colors.surfaceMuted,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.regular,
              height: portraitSize,
              width: portraitSize,
            }}
          />
        ) : (
          <Portrait label={npc.name} size={portraitSize} />
        )}
        <View style={{ flex: 1, gap: tokens.spacing.xs }}>
          <Text variant="subtitle">{npc.name}</Text>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: tokens.spacing.xs,
            }}
          >
            <Chip
              style={{
                backgroundColor: roleTone.background,
                borderColor: roleTone.border,
              }}
            >
              {ROLE_LABEL[npc.role]}
            </Chip>
            <Chip>
              <Text variant="caption">
                {`${capitalize(vibe)} `}
                <Text muted variant="caption">{`(${npc.disposition})`}</Text>
              </Text>
            </Chip>
          </View>
        </View>
      </View>

      {topFacts.length > 0 ? (
        <View style={{ gap: tokens.spacing.xs }}>
          {topFacts.map((fact, idx) => (
            <Text key={`${npc.id}-fact-${idx}`} variant="bodySmall">
              {`· ${fact}`}
            </Text>
          ))}
        </View>
      ) : null}

      {visibleAttributes.length > 0 ? (
        <View
          accessibilityLabel={`${npc.name} attributes`}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}
        >
          {visibleAttributes.map((attr) => (
            <Chip key={attr.id}>{`${attr.label} ${attr.value}`}</Chip>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}
