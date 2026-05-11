import { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";

import { Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

type StreamingPlaceholderProps = {
  /**
   * When true, the placeholder is mounted. The host must unmount this
   * component once the first paragraph arrives — the placeholder must never
   * block rendering.
   */
  active: boolean;
  /**
   * When true, animation is suppressed. Pulse is replaced with a static
   * accessible note.
   */
  reduceMotion?: boolean;
  /**
   * Show the placeholder only after this many ms have elapsed. Useful so a
   * very fast first-paragraph never reveals the placeholder at all.
   * Defaults to 0 (show immediately when active).
   */
  showAfterMs?: number;
  /**
   * Optional caption explaining what the reader is waiting on.
   */
  caption?: string;
};

const LINE_WIDTHS = ["96%", "88%", "72%"] as const;

export function StreamingPlaceholder({
  active,
  caption = "Listening for the first paragraph...",
  reduceMotion = false,
  showAfterMs = 0,
}: StreamingPlaceholderProps) {
  const [visible, setVisible] = useState(active && showAfterMs === 0);
  const pulse = useRef(new Animated.Value(0)).current;
  const { tokens } = useAppTheme();

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    if (showAfterMs <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), showAfterMs);
    return () => clearTimeout(timer);
  }, [active, showAfterMs]);

  useEffect(() => {
    if (!visible || reduceMotion) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, visible]);

  if (!visible) return null;

  const opacity = reduceMotion
    ? 0.6
    : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });

  return (
    <Surface
      accessibilityLabel={caption}
      accessibilityLiveRegion="polite"
      padded
      style={{ gap: tokens.spacing.sm }}
    >
      <Text muted variant="caption">
        {caption}
      </Text>
      <View style={{ gap: tokens.spacing.xs }}>
        {LINE_WIDTHS.map((width, index) => (
          <Animated.View
            key={index}
            style={{
              backgroundColor: tokens.colors.surfaceMuted,
              borderRadius: tokens.radii.xs,
              height: 12,
              opacity,
              width: width as unknown as number,
            }}
          />
        ))}
      </View>
    </Surface>
  );
}
