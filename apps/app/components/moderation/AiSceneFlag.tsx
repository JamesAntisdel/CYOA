import { View } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "../primitives";
import { ReportButton } from "./ReportButton";

type AiSceneFlagProps = {
  /** The current save being read — the report target for a flagged scene. */
  saveId: string;
};

/**
 * AI-generated-content disclosure + report affordance for the reader chrome
 * (product-readiness launch blocker: Play GenAI policy requires AI-generated
 * content be disclosed, and UGC policy requires a per-scene report path).
 *
 * Scenes in this app are LLM-authored, so the reader chrome carries a quiet
 * "AI-generated" stamp plus a flag that reports the current scene/run to the
 * moderation queue. Rendered as auxiliary chrome so it doesn't compete with the
 * turn affordances. Self-contained — the report path resolves its own session.
 */
export function AiSceneFlag({ saveId }: AiSceneFlagProps) {
  const { tokens } = useAppTheme();
  if (!saveId) return null;

  return (
    <View
      accessibilityLabel="AI-generated content"
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.sm,
      }}
    >
      <View
        style={{
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: 2,
        }}
      >
        <Text
          style={{ color: tokens.colors.textMuted, fontWeight: "800", letterSpacing: 0.5 }}
          variant="caption"
        >
          ✦ AI-generated
        </Text>
      </View>
      <ReportButton
        label="Flag scene"
        targetId={saveId}
        targetLabel="this AI-generated scene"
        targetType="scene"
        variant="pill"
      />
    </View>
  );
}
