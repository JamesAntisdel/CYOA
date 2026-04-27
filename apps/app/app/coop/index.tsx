import { useState } from "react";

import { CoopRoomScreen } from "../../components/coop";

const initialRoom = {
  roomId: "demo-room",
  saveId: "demo-save",
  roomCode: "CANDLE",
  status: "active" as const,
  mode: "vote" as const,
  spectatorMode: "read_only" as const,
  participants: [
    {
      participantId: "p_host",
      displayName: "Host",
      avatarInitial: "H",
      role: "host" as const,
      presence: "online" as const,
      hasVoted: false,
    },
    {
      participantId: "p_reader",
      displayName: "Reader",
      avatarInitial: "R",
      role: "player" as const,
      presence: "online" as const,
      hasVoted: false,
    },
  ],
};

const choices = [
  { choiceId: "left", label: "Open the left-hand door" },
  { choiceId: "right", label: "Follow the candle smoke" },
  { choiceId: "wait", label: "Wait and listen" },
];

export default function CoopRoute() {
  const [votedChoiceId, setVotedChoiceId] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const room = {
    ...initialRoom,
    status: closed ? ("closed" as const) : initialRoom.status,
    participants: initialRoom.participants.map((participant) =>
      participant.participantId === "p_reader"
        ? { ...participant, hasVoted: votedChoiceId !== null }
        : participant,
    ),
  };

  return (
    <CoopRoomScreen
      choices={choices}
      currentParticipantId="p_reader"
      onCloseRoom={() => setClosed(true)}
      onCopyInvite={() => undefined}
      onRotateInvite={() => setVotedChoiceId(null)}
      onVote={setVotedChoiceId}
      room={room}
    />
  );
}
