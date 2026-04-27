import type { CoopParticipantProjection } from "@cyoa/shared";

export type RawCoopParticipant = {
  participantId: string;
  displayName: string;
  avatarInitial: string;
  role: "host" | "player" | "spectator";
  lastSeenAt: number;
  accountId?: string;
  guestTokenHash?: string;
};

export function projectCoopParticipant(
  participant: RawCoopParticipant,
  now: number,
  votedChoiceIds: Record<string, string> = {},
): CoopParticipantProjection {
  return {
    participantId: participant.participantId,
    displayName: participant.displayName,
    avatarInitial: participant.avatarInitial,
    role: participant.role,
    presence: participant.lastSeenAt > now - 30_000 ? "online" : "idle",
    hasVoted: votedChoiceIds[participant.participantId] !== undefined,
  };
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  ) as Partial<T>;
}
