import type { ReactNode } from "react";
import { View } from "react-native";

import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type EmptyStateProps = {
  /** Short ALL-CAPS stamp label (e.g. "the shelf"). Optional. */
  kicker?: string;
  /** Book-voice title (one short sentence). */
  title: string;
  /** Optional book-voice body copy. */
  body?: string;
  /** Optional call-to-action label. */
  actionLabel?: string;
  /** Called when the user taps the CTA. */
  onAction?: () => void;
  /** Optional ornament rendered above the title (e.g. an Icon). */
  ornament?: ReactNode;
};

/**
 * Book-voice empty state. Use anywhere a list, shelf, or feed has nothing to
 * show. Stays calm and curious; never apologises in error language.
 */
export function EmptyState({
  actionLabel,
  body,
  kicker,
  onAction,
  ornament,
  title,
}: EmptyStateProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      padded
      style={{
        alignItems: "center",
        gap: tokens.spacing.md,
        paddingVertical: tokens.spacing.xxl,
      }}
    >
      {ornament ? <View>{ornament}</View> : null}
      {kicker ? <Stamp>{kicker}</Stamp> : null}
      <Text style={{ textAlign: "center" }} variant="subtitle">
        {title}
      </Text>
      {body ? (
        <Text muted style={{ maxWidth: 420, textAlign: "center" }} variant="body">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button onPress={onAction} variant="primary">
          {actionLabel}
        </Button>
      ) : null}
    </Surface>
  );
}
