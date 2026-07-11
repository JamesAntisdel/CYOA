import { View } from "react-native";

import type { RemoteWhatMightHaveBeen } from "../../lib/gameApi";
import { whatMightHaveBeenCards, whatMightHaveBeenTeaser } from "../../lib/storyEngagementW3";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type WhatMightHaveBeenProps = {
  /**
   * The UNREACHED candidate endings from `projection.ending.whatMightHaveBeen`.
   * The server projects these ONLY post-terminal (BC10); this surface adds a
   * defensive terminal gate on top.
   */
  candidates: RemoteWhatMightHaveBeen[] | null | undefined;
  /**
   * Whether the save is terminal. Required — the fogged cards NEVER render on a
   * live (pre-terminal) save or a legacy arc-less save (R14.1 / BC9/BC10).
   */
  terminal: boolean;
  /**
   * Fork the run from an earlier decision (existing Req 21 fork flow). Wired by
   * the host to the tale/fork path.
   */
  onFork: () => void;
  /** Start a brand-new run ("Begin again"). */
  onBeginAgain: () => void;
};

/**
 * WhatMightHaveBeen (design §4.3, R14) — on the terminal ending panel of an arc
 * save, 1–2 FOGGED cards for candidate endings the reader did NOT reach
 * ("Had you trusted the ferryman… — The Drowned Crown"). Label + hint only —
 * never the full ending, so the door stays enticing without spoiling it.
 *
 * Two CTAs: "Fork from a decision" (reuses the existing fork flow) and
 * "Begin again". Renders nothing when the save isn't terminal or carries no
 * unreached candidates.
 */
export function WhatMightHaveBeen({
  candidates,
  terminal,
  onFork,
  onBeginAgain,
}: WhatMightHaveBeenProps) {
  const { tokens } = useAppTheme();
  const cards = whatMightHaveBeenCards(candidates, { terminal });
  if (cards.length === 0) return null;

  return (
    <Surface
      accessibilityLabel="What might have been"
      padded
      style={{ gap: tokens.spacing.md }}
      variant="muted"
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>what might have been</Stamp>
        <Text muted variant="bodySmall">
          Other endings waited down paths you didn't take.
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.sm }}>
        {cards.map((card, index) => (
          <View
            accessibilityLabel={`Unreached ending: ${whatMightHaveBeenTeaser(card)}`}
            key={`${card.label}-${index}`}
            style={{
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.sm,
              // Dashed muted border = "unfinished business" (matches the
              // locked-choice + locked-ending fog affordance).
              borderStyle: "dashed",
              borderWidth: tokens.borderWidths.hairline,
              gap: 2,
              padding: tokens.spacing.md,
            }}
          >
            {card.hint ? (
              <Text
                style={{ fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
                tone="faint"
                variant="bodySmall"
              >
                {card.hint}
              </Text>
            ) : null}
            <Text style={{ fontWeight: "700" }} variant="body">
              {`🌫 ${card.label}`}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        <Button accessibilityLabel="Fork from a decision" onPress={onFork}>
          Fork from a decision
        </Button>
        <Button accessibilityLabel="Begin again" onPress={onBeginAgain} variant="primary">
          Begin again
        </Button>
      </View>
    </Surface>
  );
}
