import { useState } from "react";
import { Pressable, View } from "react-native";

import { CinematicMoment } from "../media/CinematicMoment";
import { Text } from "../primitives";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useAppTheme } from "../../theme";
import type { EndingNode } from "./EndingsMap";

type TrophyCryptProps = {
  endings: EndingNode[];
};

/**
 * Trophy crypt — summary count + a grid of trophy cards. Themed through
 * tokens so the surface paints correctly in day, night, and sepia.
 * Unlocked trophies get an accent-tinted background; locked trophies
 * use the muted surface so the grid still reads as a complete set
 * without revealing locked titles.
 *
 * Unlocked endings that carry an endpoint (Omni) cinematic for one of the
 * reader's saves expose an inline "▷ Cinematic" affordance (omni-cinematics
 * Req 7.3): tapping the card expands a full-bleed `<CinematicMoment>` below
 * the grid so the reader can replay the movie of that playthrough.
 */
export function TrophyCrypt({ endings }: TrophyCryptProps) {
  const { reduceMotion, tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const [openEndingId, setOpenEndingId] = useState<string | null>(null);
  const unlockedCount = endings.filter((ending) => ending.unlocked).length;

  const openEnding = endings.find(
    (ending) => ending.id === openEndingId && ending.cinematic,
  );

  return (
    <View style={{ gap: tokens.spacing.md }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Text style={{ fontWeight: "800" }} variant="subtitle">
          Trophy crypt
        </Text>
        <Text muted variant="bodySmall">
          {unlockedCount} of {endings.length} endings found
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
        {endings.map((ending) => {
          const hasCinematic = ending.unlocked && Boolean(ending.cinematic);
          const cinematicReady = ending.cinematic?.status === "ready";
          const isOpen = openEndingId === ending.id;
          const card = (
            <View
              style={{
                alignItems: "center",
                backgroundColor: ending.unlocked
                  ? tokens.colors.accentMuted
                  : tokens.colors.surface,
                borderColor: isOpen
                  ? tokens.colors.accent
                  : ending.unlocked
                    ? tokens.colors.border
                    : tokens.colors.borderMuted,
                borderRadius: tokens.radii.sm,
                // A ready keepsake gets a heavier frame so it reads as an
                // earned artifact, not just another tile in the grid.
                borderWidth:
                  cinematicReady && !isOpen
                    ? tokens.borderWidths.regular
                    : tokens.borderWidths.hairline,
                gap: tokens.spacing.xs,
                minHeight: 88,
                padding: tokens.spacing.md,
                width: 132,
              }}
            >
              <Text
                style={{
                  color: ending.unlocked
                    ? tokens.colors.accent
                    : tokens.colors.textFaint,
                }}
                variant="subtitle"
              >
                {ending.unlocked ? "◆" : "◇"}
              </Text>
              <Text
                style={{ fontWeight: "700", textAlign: "center" }}
                variant="bodySmall"
              >
                {ending.unlocked ? ending.title : "Locked"}
              </Text>
              {hasCinematic ? (
                <Text
                  style={{
                    color: cinematicReady
                      ? tokens.colors.accent
                      : tokens.colors.textMuted,
                    fontWeight: "800",
                  }}
                  variant="caption"
                >
                  {isOpen
                    ? "Close"
                    : cinematicReady
                      ? "❖ Watch legend"
                      : "◷ Rendering…"}
                </Text>
              ) : null}
            </View>
          );

          if (!hasCinematic) {
            return <View key={ending.id}>{card}</View>;
          }
          return (
            <Pressable
              key={ending.id}
              accessibilityRole="button"
              accessibilityLabel={
                isOpen
                  ? `Hide cinematic for ${ending.title}`
                  : cinematicReady
                    ? `Watch your legend for ${ending.title}`
                    : `Cinematic for ${ending.title} is still rendering`
              }
              accessibilityState={{ expanded: isOpen }}
              onPress={() => setOpenEndingId(isOpen ? null : ending.id)}
            >
              {card}
            </Pressable>
          );
        })}
      </View>

      {openEnding?.cinematic ? (
        // Keepsake frame: a titled, bordered plate that presents the reader's
        // own cinematic as "the movie of your playthrough" (Req 7.3) rather
        // than a bare thumbnail. The CinematicMoment inside runs the full
        // four-state pattern + native-audio mix.
        <View
          style={{
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.accent,
            borderRadius: tokens.radii.md,
            borderWidth: tokens.borderWidths.regular,
            gap: tokens.spacing.sm,
            padding: tokens.spacing.md,
          }}
        >
          <View style={{ gap: tokens.spacing.xs }}>
            <Text
              style={{
                color: tokens.colors.accent,
                fontFamily: tokens.typography.families.mono,
                fontWeight: "800",
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
              variant="caption"
            >
              Your legend
            </Text>
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              {openEnding.title}
            </Text>
            <Text muted variant="bodySmall">
              The movie of your playthrough.
            </Text>
          </View>
          <CinematicMoment
            cinematic={openEnding.cinematic}
            reducedMotion={reduceMotion || settings.reduceMotion}
            muted={settings.muted}
            audioEnabled={settings.audioEnabled}
            {...(openEnding.cinematic.posterUrl
              ? { posterFallbackUri: openEnding.cinematic.posterUrl }
              : {})}
          />
        </View>
      ) : null}
    </View>
  );
}
