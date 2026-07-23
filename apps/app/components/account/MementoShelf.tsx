import { View } from "react-native";

import { Stamp, Surface, Text } from "../primitives";
import {
  mementoRelativeDate,
  type MementoShelfModel,
} from "../../lib/storyEngagementW3";
import { useAppTheme } from "../../theme";

type MementoShelfProps = {
  mementos: MementoShelfModel;
};

const ACT_ROMAN = ["I", "II", "III", "IV", "V"];
function actRoman(n: number): string {
  if (n < 1) return "I";
  if (n <= ACT_ROMAN.length) return ACT_ROMAN[n - 1]!;
  return String(n);
}

/**
 * The Mementos shelf (act-mementos R4) — a quieter companion to the keepsakes
 * shelf, mounted BELOW it on the profile. Where a keepsake says "I finished a
 * story", a memento says "I was there": the pressed page of a run that crossed
 * an act boundary and may never end. The hierarchy is the requirement (R4.1),
 * so these cards are smaller and lower-contrast than keepsake cards.
 *
 * Renders nothing at all when the account has pressed no mementos (R4.2 — no
 * empty-state upsell in v1). The section header carries the lifetime total,
 * which can exceed the (server-capped) items shown.
 */
export function MementoShelf({ mementos }: MementoShelfProps) {
  const { tokens } = useAppTheme();
  if (mementos.items.length === 0) return null;
  const now = Date.now();

  return (
    <Surface padded style={{ gap: tokens.spacing.sm, maxWidth: 640, width: "100%" }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
        <Stamp>mementos</Stamp>
        <Text muted variant="caption">
          {`· ${mementos.total}`}
        </Text>
      </View>
      <Text muted variant="bodySmall">
        Pressed between the pages — the acts you reached, kept even if the tale is gone.
      </Text>
      <View style={{ gap: tokens.spacing.xs }}>
        {mementos.items.map((memento, index) => (
          <View
            key={`${memento.storyTitle}-${memento.act}-${memento.createdAt}-${index}`}
            style={{
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.hairline,
              gap: 2,
              opacity: 0.92,
              padding: tokens.spacing.sm,
            }}
          >
            <Text muted style={{ fontWeight: "600" }} variant="caption">
              {`❦ ${memento.label}`}
            </Text>
            <Text muted variant="caption">
              {memento.description}
            </Text>
            <Text
              style={{ color: tokens.colors.textFaint }}
              variant="caption"
            >
              {`Act ${actRoman(memento.act)} · ${memento.storyTitle} · ${mementoRelativeDate(memento.createdAt, now)}`}
            </Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}
