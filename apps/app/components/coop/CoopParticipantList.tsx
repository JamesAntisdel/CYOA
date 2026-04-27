import type { CoopParticipantProjection } from "@cyoa/shared";
import { View } from "react-native";

import { useAppTheme } from "../../theme";
import { Chip, Surface, Text } from "../primitives";

type CoopParticipantListProps = {
  participants: CoopParticipantProjection[];
  activeParticipantId?: string | undefined;
};

export function CoopParticipantList({
  activeParticipantId,
  participants,
}: CoopParticipantListProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <Text variant="subtitle">Readers</Text>
        <View style={{ gap: tokens.spacing.sm }}>
          {participants.map((participant) => {
            const active = participant.participantId === activeParticipantId;
            return (
              <View
                key={participant.participantId}
                style={{
                  alignItems: "center",
                  borderColor: active ? tokens.colors.accent : tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  flexDirection: "row",
                  gap: tokens.spacing.sm,
                  minHeight: 48,
                  paddingHorizontal: tokens.spacing.md,
                  paddingVertical: tokens.spacing.sm,
                }}
              >
                <View
                  accessibilityLabel={`${participant.displayName} avatar`}
                  style={{
                    alignItems: "center",
                    backgroundColor: tokens.colors.accentMuted,
                    borderColor: tokens.colors.border,
                    borderRadius: tokens.radii.pill,
                    borderWidth: tokens.borderWidths.hairline,
                    height: 32,
                    justifyContent: "center",
                    width: 32,
                  }}
                >
                  <Text variant="caption">{participant.avatarInitial}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1}>{participant.displayName}</Text>
                  <Text muted variant="caption">
                    {participant.role}
                  </Text>
                </View>
                {participant.hasVoted === true ? <Chip>voted</Chip> : null}
                <Chip>{participant.presence}</Chip>
              </View>
            );
          })}
        </View>
      </View>
    </Surface>
  );
}
