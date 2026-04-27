import type { CoopRoomProjection } from "@cyoa/shared";

import { canEnableMatureContent, type AccountRecord } from "./account";
import type { EntitlementRecord } from "./billing/entitlements";
import { AppError } from "./lib/errors";
import { projectCoopParticipant } from "./lib/projections";
import type { SceneProjection, SaveRecord } from "./saves";

export type CoopMode = "pass" | "vote";
export type CoopStatus = "open" | "active" | "closed";
export type CoopVisibility = "private" | "link" | "friends";
export type CoopSpectatorMode = "off" | "read_only";
export type CoopRole = "host" | "player" | "spectator";

export type CoopParticipant = {
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
  displayName: string;
  avatarInitial: string;
  role: CoopRole;
  joinedAt: number;
  lastSeenAt: number;
  matureEligible: boolean;
};

export type CoopRoomRecord = {
  _id?: string;
  saveId: string;
  hostAccountId: string;
  roomCode: string;
  inviteTokenHash: string;
  status: CoopStatus;
  mode: CoopMode;
  visibility: CoopVisibility;
  spectatorMode: CoopSpectatorMode;
  participants: CoopParticipant[];
  activeParticipantId?: string;
  voteEndsAt?: number;
  votes: Record<string, string>;
  isMature: boolean;
  closedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type CoopRoomWithSceneProjection = CoopRoomProjection & {
  roomCode: string;
  visibility: CoopVisibility;
  spectatorMode: CoopSpectatorMode;
  isMature: boolean;
  inviteRequired: boolean;
  currentParticipantId?: string;
  scene?: SceneProjection;
};

export type CoopJoinIdentity = {
  account?: (AccountRecord & { _id: string }) | undefined;
  entitlement?: Pick<EntitlementRecord, "tier" | "status"> | null | undefined;
  guestTokenHash?: string | undefined;
};

export async function hashInviteToken(inviteToken: string): Promise<string> {
  const token = inviteToken.trim();
  if (token.length < 16) throw new AppError("invite_token_too_short");
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createCoopRoom(input: {
  save: SaveRecord & { _id: string };
  hostAccount: AccountRecord & { _id: string };
  hostEntitlement?: Pick<EntitlementRecord, "tier" | "status"> | null;
  roomCode: string;
  inviteToken: string;
  mode: CoopMode;
  now: number;
  displayName?: string;
  visibility?: CoopVisibility;
  spectatorMode?: CoopSpectatorMode;
  isMature?: boolean;
}): Promise<CoopRoomRecord> {
  if (input.save.accountId !== input.hostAccount._id) throw new AppError("save_forbidden");
  assertRoomCode(input.roomCode);
  const isMature = input.isMature === true;
  const matureEligible = isMature
    ? assertMatureRoomEligible(input.hostAccount, input.hostEntitlement)
    : canEnableMatureContent(input.hostAccount, input.hostEntitlement);
  const hostParticipant = buildParticipant({
    participantId: "host",
    accountId: input.hostAccount._id,
    displayName: input.displayName ?? "Host",
    role: "host",
    now: input.now,
    matureEligible,
  });

  return withOptionalRoomFields({
    saveId: input.save._id,
    hostAccountId: input.hostAccount._id,
    roomCode: input.roomCode.trim().toUpperCase(),
    inviteTokenHash: await hashInviteToken(input.inviteToken),
    status: "open",
    mode: input.mode,
    visibility: input.visibility ?? "link",
    spectatorMode: input.spectatorMode ?? "read_only",
    participants: [hostParticipant],
    votes: {},
    isMature,
    createdAt: input.now,
    updatedAt: input.now,
  }, {
    activeParticipantId: input.mode === "pass" ? hostParticipant.participantId : undefined,
  });
}

export async function joinCoopRoom(input: {
  room: CoopRoomRecord;
  inviteToken: string;
  identity: CoopJoinIdentity;
  displayName: string;
  now: number;
  role?: "player" | "spectator";
}): Promise<{ room: CoopRoomRecord; participantId: string }> {
  assertRoomOpen(input.room);
  if (input.room.inviteTokenHash !== await hashInviteToken(input.inviteToken)) {
    throw new AppError("invite_invalid");
  }

  const requestedRole = input.role ?? "player";
  if (requestedRole === "spectator" && input.room.spectatorMode === "off") {
    throw new AppError("spectators_disabled");
  }

  const account = input.identity.account;
  const guestTokenHash = input.identity.guestTokenHash?.trim();
  if (!account && !guestTokenHash) throw new AppError("participant_identity_required");

  const matureEligible = account
    ? canEnableMatureContent(account, input.identity.entitlement)
    : false;
  if (input.room.isMature && !matureEligible) throw new AppError("mature_room_not_allowed");

  const existingIndex = input.room.participants.findIndex((participant) =>
    account
      ? participant.accountId === account._id
      : participant.guestTokenHash === guestTokenHash,
  );

  if (existingIndex >= 0) {
    const existing = input.room.participants[existingIndex];
    if (!existing) throw new AppError("participant_not_found");
    const nextParticipants = input.room.participants.slice();
    nextParticipants[existingIndex] = {
      ...existing,
      displayName: sanitizeDisplayName(input.displayName),
      avatarInitial: avatarInitial(input.displayName),
      lastSeenAt: input.now,
      matureEligible,
    };
    return {
      participantId: existing.participantId,
      room: enforceMatureRoom({
        ...input.room,
        participants: nextParticipants,
        updatedAt: input.now,
      }),
    };
  }

  const participant = buildParticipant({
    participantId: nextParticipantId(input.room),
    accountId: account?._id,
    guestTokenHash: account ? undefined : guestTokenHash,
    displayName: input.displayName,
    role: requestedRole,
    now: input.now,
    matureEligible,
  });
  const activeParticipantId =
    input.room.mode === "pass" && input.room.activeParticipantId === undefined && requestedRole === "player"
      ? participant.participantId
      : input.room.activeParticipantId;
  const nextRoom = enforceMatureRoom(withOptionalRoomFields({
    ...input.room,
    status: "active",
    participants: [...input.room.participants, participant],
    updatedAt: input.now,
  }, { activeParticipantId }));

  return { room: nextRoom, participantId: participant.participantId };
}

export async function rotateInviteToken(
  room: CoopRoomRecord,
  actorParticipantId: string,
  inviteToken: string,
  now: number,
): Promise<CoopRoomRecord> {
  assertHostParticipant(room, actorParticipantId);
  return {
    ...room,
    inviteTokenHash: await hashInviteToken(inviteToken),
    updatedAt: now,
  };
}

export function castCoopVote(
  room: CoopRoomRecord,
  participantId: string,
  choiceId: string,
  now: number,
): CoopRoomRecord {
  assertRoomOpen(room);
  if (room.mode !== "vote") throw new AppError("room_not_vote_mode");
  const participant = requireParticipant(room, participantId);
  if (participant.role === "spectator") throw new AppError("spectator_cannot_vote");
  if (choiceId.trim().length === 0) throw new AppError("choice_required");
  return {
    ...room,
    status: "active",
    voteEndsAt: room.voteEndsAt ?? now + 60_000,
    votes: { ...room.votes, [participantId]: choiceId },
    updatedAt: now,
  };
}

export function resolveCoopVote(room: CoopRoomRecord, now: number): { room: CoopRoomRecord; choiceId: string } {
  if (room.mode !== "vote") throw new AppError("room_not_vote_mode");
  const playerIds = room.participants
    .filter((participant) => participant.role !== "spectator")
    .map((participant) => participant.participantId);
  const votes = Object.entries(room.votes).filter(([participantId]) => playerIds.includes(participantId));
  if (votes.length === 0) throw new AppError("vote_unresolved");

  const counts = new Map<string, number>();
  for (const [, choiceId] of votes) counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const winner = ordered[0];
  if (!winner) throw new AppError("vote_unresolved");
  const hasAllVotes = votes.length >= playerIds.length;
  const timerExpired = room.voteEndsAt !== undefined && room.voteEndsAt <= now;
  if (!hasAllVotes && !timerExpired) throw new AppError("vote_unresolved");

  return {
    choiceId: winner[0],
    room: withoutOptionalRoomFields({
      ...room,
      votes: {},
      updatedAt: now,
    }, ["voteEndsAt"]),
  };
}

export function assertCanSubmitPassChoice(room: CoopRoomRecord, participantId: string): void {
  assertRoomOpen(room);
  if (room.mode !== "pass") throw new AppError("room_not_pass_mode");
  const participant = requireParticipant(room, participantId);
  if (participant.role === "spectator") throw new AppError("spectator_cannot_submit");
  const hostCanSubmit = participant.role === "host";
  if (!hostCanSubmit && room.activeParticipantId !== participantId) {
    throw new AppError("participant_turn_required");
  }
}

export function advancePassTurn(room: CoopRoomRecord, now: number): CoopRoomRecord {
  if (room.mode !== "pass") throw new AppError("room_not_pass_mode");
  const players = room.participants.filter((participant) => participant.role !== "spectator");
  if (players.length === 0) throw new AppError("participant_not_found");
  const currentIndex = Math.max(
    0,
    players.findIndex((participant) => participant.participantId === room.activeParticipantId),
  );
  const next = players[(currentIndex + 1) % players.length];
  if (!next) throw new AppError("participant_not_found");
  return {
    ...room,
    activeParticipantId: next.participantId,
    updatedAt: now,
  };
}

export function changeCoopMode(
  room: CoopRoomRecord,
  actorParticipantId: string,
  mode: CoopMode,
  now: number,
): CoopRoomRecord {
  assertHostParticipant(room, actorParticipantId);
  const firstPlayer = room.participants.find((participant) => participant.role !== "spectator");
  return withoutOptionalRoomFields(withOptionalRoomFields({
    ...room,
    mode,
    votes: {},
    updatedAt: now,
  }, { activeParticipantId: mode === "pass" ? firstPlayer?.participantId : undefined }), ["voteEndsAt"]);
}

export function removeCoopParticipant(
  room: CoopRoomRecord,
  actorParticipantId: string,
  participantId: string,
  now: number,
): CoopRoomRecord {
  assertHostParticipant(room, actorParticipantId);
  const removed = requireParticipant(room, participantId);
  if (removed.role === "host") throw new AppError("cannot_remove_host");
  const participants = room.participants.filter((participant) => participant.participantId !== participantId);
  const votes = { ...room.votes };
  delete votes[participantId];
  const activeWasRemoved = room.activeParticipantId === participantId;
  const firstPlayer = participants.find((participant) => participant.role !== "spectator");
  return enforceMatureRoom(withOptionalRoomFields({
    ...room,
    participants,
    votes,
    updatedAt: now,
  }, { activeParticipantId: activeWasRemoved ? firstPlayer?.participantId : room.activeParticipantId }));
}

export function recoverCoopHost(room: CoopRoomRecord, actorParticipantId: string, now: number): CoopRoomRecord {
  const actor = requireParticipant(room, actorParticipantId);
  if (actor.accountId !== room.hostAccountId) throw new AppError("host_recovery_forbidden");
  return {
    ...room,
    participants: room.participants.map((participant) =>
      participant.participantId === actorParticipantId
        ? { ...participant, role: "host", lastSeenAt: now }
        : participant.role === "host"
          ? { ...participant, role: "player" }
          : participant,
    ),
    updatedAt: now,
  };
}

export function closeCoopRoom(room: CoopRoomRecord, actorParticipantId: string, now: number): CoopRoomRecord {
  assertHostParticipant(room, actorParticipantId);
  return {
    ...room,
    status: "closed",
    closedAt: now,
    updatedAt: now,
  };
}

export function touchCoopPresence(room: CoopRoomRecord, participantId: string, now: number): CoopRoomRecord {
  requireParticipant(room, participantId);
  return {
    ...room,
    participants: room.participants.map((participant) =>
      participant.participantId === participantId ? { ...participant, lastSeenAt: now } : participant,
    ),
    updatedAt: now,
  };
}

export function projectCoopRoom(
  room: CoopRoomRecord,
  now: number,
  currentParticipantId?: string,
  scene?: SceneProjection,
): CoopRoomWithSceneProjection {
  return withOptionalProjectionFields({
    roomId: room._id ?? room.roomCode,
    saveId: room.saveId,
    roomCode: room.roomCode,
    status: room.status,
    mode: room.mode,
    visibility: room.visibility,
    spectatorMode: room.spectatorMode,
    participants: room.participants.map((participant) =>
      projectCoopParticipant(participant, now, room.votes),
    ),
    isMature: room.isMature,
    inviteRequired: room.status !== "closed",
  }, {
    activeParticipantId: room.activeParticipantId,
    voteEndsAt: room.voteEndsAt,
    currentParticipantId,
    scene,
  });
}

function buildParticipant(input: {
  participantId: string;
  accountId?: string | undefined;
  guestTokenHash?: string | undefined;
  displayName: string;
  role: CoopRole;
  now: number;
  matureEligible: boolean;
}): CoopParticipant {
  return {
    participantId: input.participantId,
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.guestTokenHash === undefined ? {} : { guestTokenHash: input.guestTokenHash }),
    displayName: sanitizeDisplayName(input.displayName),
    avatarInitial: avatarInitial(input.displayName),
    role: input.role,
    joinedAt: input.now,
    lastSeenAt: input.now,
    matureEligible: input.matureEligible,
  };
}

function assertRoomCode(roomCode: string): void {
  if (!/^[A-Z0-9-]{4,24}$/u.test(roomCode.trim().toUpperCase())) {
    throw new AppError("room_code_invalid");
  }
}

function assertRoomOpen(room: CoopRoomRecord): void {
  if (room.status === "closed") throw new AppError("room_closed");
}

function assertMatureRoomEligible(
  account: AccountRecord,
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined,
): true {
  if (!canEnableMatureContent(account, entitlement)) throw new AppError("mature_room_not_allowed");
  return true;
}

function enforceMatureRoom(room: CoopRoomRecord): CoopRoomRecord {
  if (!room.isMature) return room;
  if (room.participants.some((participant) => !participant.matureEligible)) {
    throw new AppError("mature_room_not_allowed");
  }
  return room;
}

function requireParticipant(room: CoopRoomRecord, participantId: string): CoopParticipant {
  const participant = room.participants.find((entry) => entry.participantId === participantId);
  if (!participant) throw new AppError("participant_not_found");
  return participant;
}

function assertHostParticipant(room: CoopRoomRecord, participantId: string): void {
  const participant = requireParticipant(room, participantId);
  if (participant.role !== "host") throw new AppError("host_required");
}

function sanitizeDisplayName(displayName: string): string {
  const sanitized = displayName.trim().replace(/\s+/gu, " ");
  return sanitized.length === 0 ? "Reader" : sanitized.slice(0, 40);
}

function avatarInitial(displayName: string): string {
  return sanitizeDisplayName(displayName).slice(0, 1).toUpperCase();
}

function nextParticipantId(room: CoopRoomRecord): string {
  let index = room.participants.length + 1;
  let participantId = `p${index}`;
  while (room.participants.some((participant) => participant.participantId === participantId)) {
    index += 1;
    participantId = `p${index}`;
  }
  return participantId;
}

function withOptionalRoomFields(
  room: Omit<CoopRoomRecord, "activeParticipantId" | "voteEndsAt" | "closedAt"> &
    Partial<Pick<CoopRoomRecord, "activeParticipantId" | "voteEndsAt" | "closedAt">>,
  optional: {
    activeParticipantId?: string | undefined;
    voteEndsAt?: number | undefined;
    closedAt?: number | undefined;
  },
): CoopRoomRecord {
  return Object.fromEntries(
    Object.entries({ ...room, ...optional }).filter(([, value]) => value !== undefined),
  ) as CoopRoomRecord;
}

function withoutOptionalRoomFields(
  room: CoopRoomRecord,
  keys: Array<"activeParticipantId" | "voteEndsAt" | "closedAt">,
): CoopRoomRecord {
  const next = { ...room };
  for (const key of keys) delete next[key];
  return next;
}

function withOptionalProjectionFields(
  projection: Omit<
    CoopRoomWithSceneProjection,
    "activeParticipantId" | "voteEndsAt" | "currentParticipantId" | "scene"
  > &
    Partial<Pick<CoopRoomWithSceneProjection, "activeParticipantId" | "voteEndsAt" | "currentParticipantId" | "scene">>,
  optional: {
    activeParticipantId?: string | undefined;
    voteEndsAt?: number | undefined;
    currentParticipantId?: string | undefined;
    scene?: SceneProjection | undefined;
  },
): CoopRoomWithSceneProjection {
  return Object.fromEntries(
    Object.entries({ ...projection, ...optional }).filter(([, value]) => value !== undefined),
  ) as CoopRoomWithSceneProjection;
}
