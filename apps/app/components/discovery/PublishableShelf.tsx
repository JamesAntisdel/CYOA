import { View } from "react-native";

import type { LibrarySave } from "../../hooks/useLibrary";
import { useAppTheme } from "../../theme";
import { Button, Chip, Stamp, Surface, Text } from "../primitives";
import {
  publishableStatusLabel,
  selectPublishableSaves,
  turnCountLabel,
} from "./publishableSaves";

type PublishableShelfProps = {
  /** The reader's full library; the shelf selects the eligible subset. */
  saves: LibrarySave[];
  /** Called with the saveId when the reader taps "Share this tale". */
  onPublish: (saveId: string) => void;
};

/**
 * Interim Discover surface: the reader's own completed (or at least started)
 * runs with a CTA into the existing publish flow. Renders nothing when the
 * reader has no eligible saves — guests and fresh accounts just see the
 * archive empty state above this. Retire this once the public-tales query
 * ships and the shelf fills with other readers' work.
 */
export function PublishableShelf({ onPublish, saves }: PublishableShelfProps) {
  const { tokens } = useAppTheme();
  const publishable = selectPublishableSaves(saves);

  if (publishable.length === 0) {
    return null;
  }

  return (
    <View style={{ gap: tokens.spacing.md }}>
      <View style={{ gap: tokens.spacing.sm }}>
        <Stamp>from your library</Stamp>
        <Text variant="title">Tales of yours, ready for the shelf.</Text>
        <Text muted variant="bodySmall">
          A finished run can be bound and published for other readers to find.
        </Text>
      </View>

      {publishable.map((save) => (
        <Surface
          key={save.saveId}
          style={{ gap: tokens.spacing.md, padding: tokens.spacing.lg }}
        >
          <Text variant="subtitle">{save.title}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
            <Chip>{publishableStatusLabel(save.status)}</Chip>
            <Chip>{turnCountLabel(save.turnNumber)}</Chip>
            {save.mode === "hardcore" ? <Chip>hardcore</Chip> : null}
          </View>
          <View style={{ alignSelf: "flex-start" }}>
            <Button
              accessibilityLabel={`Share ${save.title}`}
              onPress={() => onPublish(save.saveId)}
              variant="primary"
            >
              Share this tale
            </Button>
          </View>
        </Surface>
      ))}
    </View>
  );
}
