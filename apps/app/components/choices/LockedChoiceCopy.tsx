import { View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

type LockedChoiceCopyProps = {
  /**
   * Optional visible hint shown to the reader. The hint should describe an
   * observable in-world signal (e.g. "the door is barred") — never a hidden
   * flag, stat threshold, or scripted requirement name.
   */
  hint?: string | undefined;
};

/**
 * Spec-gap guidance shown beneath a locked choice. The copy must not reveal
 * any hidden flags, raw stat thresholds, or scripted requirement IDs. We
 * surface a generic narrator note plus an optional in-world hint.
 */
export function LockedChoiceCopy({ hint }: LockedChoiceCopyProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityLabel="Locked choice guidance"
      style={{
        borderColor: tokens.colors.danger,
        borderLeftWidth: tokens.borderWidths.regular,
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.sm,
      }}
    >
      <Text style={{ color: tokens.colors.danger, fontWeight: "700" }} variant="caption">
        Path closed for now
      </Text>
      <Text muted variant="bodySmall">
        Something the story has not yet given you would be needed here.
      </Text>
      {hint ? (
        <Text muted variant="caption">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
