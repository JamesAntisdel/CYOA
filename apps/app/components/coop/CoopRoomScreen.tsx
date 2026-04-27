import type { CoopRoomProjection } from "@cyoa/shared";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CoopChoice, useCoopRoomState } from "../../hooks/useCoopRoom";
import { useAppTheme } from "../../theme";
import { Button, Chip, Divider, Stamp, Surface, Text } from "../primitives";
import { CoopParticipantList } from "./CoopParticipantList";
import { CoopTurnPanel } from "./CoopTurnPanel";

type CoopRoomScreenProps = {
  room: CoopRoomProjection & {
    roomCode?: string;
    spectatorMode?: "off" | "read_only";
    isMature?: boolean;
  };
  choices: CoopChoice[];
  currentParticipantId?: string | undefined;
  onCloseRoom?: (() => void) | undefined;
  onCopyInvite?: (() => void) | undefined;
  onPassChoice?: ((choiceId: string) => void) | undefined;
  onRotateInvite?: (() => void) | undefined;
  onVote?: ((choiceId: string) => void) | undefined;
};

export function CoopRoomScreen({
  choices,
  currentParticipantId,
  onCloseRoom,
  onCopyInvite,
  onPassChoice,
  onRotateInvite,
  onVote,
  room,
}: CoopRoomScreenProps) {
  const { tokens } = useAppTheme();
  const state = useCoopRoomState(room, currentParticipantId);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
        <View
          style={{
            alignSelf: "center",
            gap: tokens.spacing.lg,
            maxWidth: 760,
            width: "100%",
          }}
        >
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>co-op room</Stamp>
            <Text variant="title">Room {room.roomCode ?? room.roomId}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
              <Chip>{room.status}</Chip>
              <Chip>{room.mode}</Chip>
              <Chip>{state.onlineCount} online</Chip>
              {room.isMature === true ? <Chip>18+ checked</Chip> : null}
            </View>
          </View>

          <Surface padded variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Shared Page</Text>
              <Text>
                Everyone in the room reads the same server-owned save projection. Votes and
                turns update as the room changes.
              </Text>
              <Divider />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button onPress={onCopyInvite} variant="ghost">
                  Invite
                </Button>
                <Button onPress={onRotateInvite} variant="ghost">
                  Rotate
                </Button>
                <Button onPress={onCloseRoom} variant={room.status === "closed" ? "locked" : "ghost"}>
                  Close
                </Button>
              </View>
            </View>
          </Surface>

          <CoopTurnPanel
            choices={choices}
            mode={room.mode}
            onPassChoice={onPassChoice}
            onVote={onVote}
            state={state}
          />
          <CoopParticipantList
            activeParticipantId={room.activeParticipantId}
            participants={room.participants}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
