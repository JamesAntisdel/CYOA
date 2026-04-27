import { useMemo } from "react";

import type { CoopRoomProjection } from "@cyoa/shared";

export type CoopChoice = {
  choiceId: string;
  label: string;
  disabled?: boolean;
};

export type CoopRoomUiState = {
  canSubmitPassChoice: boolean;
  canVote: boolean;
  currentParticipantName: string;
  hasCurrentParticipantVoted: boolean;
  onlineCount: number;
  playerCount: number;
  voteCount: number;
};

export function useCoopRoomState(
  room: CoopRoomProjection | null | undefined,
  currentParticipantId: string | null | undefined,
): CoopRoomUiState {
  return useMemo(() => {
    const participants = room?.participants ?? [];
    const currentParticipant = participants.find(
      (participant) => participant.participantId === currentParticipantId,
    );
    const activeParticipant = participants.find(
      (participant) => participant.participantId === room?.activeParticipantId,
    );
    const isHost = currentParticipant?.role === "host";
    const isSpectator = currentParticipant?.role === "spectator";
    const isActive = room?.activeParticipantId === currentParticipantId;
    const voteCount = participants.filter((participant) => participant.hasVoted).length;

    return {
      canSubmitPassChoice:
        room?.status !== "closed" &&
        room?.mode === "pass" &&
        currentParticipant !== undefined &&
        !isSpectator &&
        (isHost || isActive),
      canVote:
        room?.status !== "closed" &&
        room?.mode === "vote" &&
        currentParticipant !== undefined &&
        !isSpectator,
      currentParticipantName: activeParticipant?.displayName ?? "Host",
      hasCurrentParticipantVoted: currentParticipant?.hasVoted === true,
      onlineCount: participants.filter((participant) => participant.presence === "online").length,
      playerCount: participants.filter((participant) => participant.role !== "spectator").length,
      voteCount,
    };
  }, [currentParticipantId, room]);
}
