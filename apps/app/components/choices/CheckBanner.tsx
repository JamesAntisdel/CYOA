import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";

import {
  checkBannerModel,
  type CheckOutcome,
} from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

/**
 * CheckBanner (design §4.2, W2-C1) — the post-turn resolution stamp shown when
 * the previous choice's skill check resolved. It reads out the outcome
 * (Success / Partial / Failed) plus an in-world MARGIN PHRASE ("by a hair",
 * "with room to spare") — never the raw roll or threshold (BC10).
 *
 * Motion: on web, non-reduced-motion readers get a brief dice-roll flutter
 * (the die face cycles) that settles on the resolved face; native and
 * reduced-motion readers see the settled stamp immediately. The reducedMotion
 * static path is the accessibility default.
 */
export type CheckBannerProps = {
  outcome: CheckOutcome;
  statId: string;
  margin: number;
  reducedMotion?: boolean;
};

const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const SETTLED_FACE = "⚄";
const ROLL_FRAMES = 6;
const ROLL_FRAME_MS = 70;

export function CheckBanner({ outcome, statId, margin, reducedMotion = false }: CheckBannerProps) {
  const { tokens } = useAppTheme();
  const model = checkBannerModel({ outcome, statId, margin });

  // Dice-roll flutter is web-only and skipped under reduced motion. `rolling`
  // starts true only when we're actually going to animate, so the settled face
  // paints immediately everywhere else.
  const animate = Platform.OS === "web" && !reducedMotion;
  const [face, setFace] = useState(animate ? DIE_FACES[0]! : SETTLED_FACE);
  const [rolling, setRolling] = useState(animate);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      setFace(SETTLED_FACE);
      setRolling(false);
      return;
    }
    frameRef.current = 0;
    setRolling(true);
    const timer = setInterval(() => {
      frameRef.current += 1;
      if (frameRef.current >= ROLL_FRAMES) {
        clearInterval(timer);
        setFace(SETTLED_FACE);
        setRolling(false);
        return;
      }
      setFace(DIE_FACES[frameRef.current % DIE_FACES.length]!);
    }, ROLL_FRAME_MS);
    return () => clearInterval(timer);
    // Re-run the flutter whenever a NEW resolution arrives (new outcome/margin).
  }, [animate, outcome, margin, statId]);

  const toneColor =
    model.tone === "negative"
      ? tokens.colors.danger
      : model.tone === "positive"
        ? tokens.colors.accent
        : tokens.colors.textMuted;
  const toneBackground =
    model.tone === "neutral" ? tokens.colors.surfaceMuted : tokens.colors.accentMuted;

  const a11yLabel = `Skill check ${model.stamp.toLowerCase()} ${model.phrase}.`;

  return (
    <View
      accessibilityLabel={a11yLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={{
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: toneBackground,
        borderColor: toneColor,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.regular,
        flexDirection: "row",
        gap: tokens.spacing.sm,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      }}
    >
      <Text aria-hidden style={{ color: toneColor }} variant="subtitle">
        {face}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: tokens.spacing.xs }}>
        <Text
          style={{
            color: toneColor,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "700",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          {model.stamp}
        </Text>
        {rolling ? null : (
          <Text muted variant="caption">
            {model.phrase}
          </Text>
        )}
      </View>
    </View>
  );
}
