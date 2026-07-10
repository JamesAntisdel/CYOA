import type { CoopRoomProjection } from "@cyoa/shared";

import { pickEndingCinematic, type RemoteCinematicView } from "./cinematicApi";
import { convexClient } from "./convex";
import { convexHttp as call } from "./convexHttp";

/**
 * Client wrappers for the co-op backend (Requirement 20). Mirrors the HTTP
 * calling convention in `gameApi.ts` (the Convex anonymous local backend
 * doesn't handshake the WS client cleanly, so every call goes through
 * `/api/mutation` | `/api/query`). Kept in its own module so gameApi stays
 * untouched.
 */

export type CoopRoomView = CoopRoomProjection & {
  roomCode?: string;
  visibility?: "private" | "link" | "friends";
  spectatorMode?: "off" | "read_only";
  isMature?: boolean;
  inviteRequired?: boolean;
  currentParticipantId?: string;
};

export type CoopChoiceView = { choiceId: string; label: string };

export type CoopCreateResult = {
  roomId: string;
  inviteToken: string;
  participantId: string;
  room: CoopRoomView;
};

export type CoopJoinResult = {
  roomId: string;
  participantId: string;
  room: CoopRoomView;
};

export type CoopRoomStateResult = {
  roomId: string;
  room: CoopRoomView;
  choices: CoopChoiceView[];
};

export function hasCoopApi(): boolean {
  return convexClient !== null;
}

export async function createCoopRoomRemote(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  mode: "pass" | "vote";
  displayName?: string;
  visibility?: "private" | "link" | "friends";
  spectatorMode?: "off" | "read_only";
  isMature?: boolean;
}): Promise<CoopCreateResult | null> {
  return call<CoopCreateResult>("mutation", "coopFunctions:createRoom", input);
}

export async function joinCoopRoomRemote(input: {
  roomId: string;
  inviteToken: string;
  displayName: string;
  accountId?: string;
  guestTokenHash?: string;
  role?: "player" | "spectator";
}): Promise<CoopJoinResult | null> {
  return call<CoopJoinResult>("mutation", "coopFunctions:joinRoom", input);
}

export async function getCoopRoomRemote(input: {
  roomId: string;
  // Required: getRoom authenticates the caller as a room participant. A reader
  // without a participantId (i.e. who hasn't joined) has no room read access.
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<CoopRoomStateResult | null> {
  return call<CoopRoomStateResult>("query", "coopFunctions:getRoom", input);
}

export async function castCoopVoteRemote(input: {
  roomId: string;
  participantId: string;
  choiceId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:castVote", input);
}

export async function resolveCoopTurnRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; choiceId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:resolveTurn", input);
}

export async function passCoopControlRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:passControl", input);
}

export async function recoverCoopHostRemote(input: {
  roomId: string;
  participantId: string;
  accountId: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:recoverHost", input);
}

export async function rotateCoopInviteRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; inviteToken: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:rotateInvite", input);
}

export async function setCoopModeRemote(input: {
  roomId: string;
  participantId: string;
  mode: "pass" | "vote";
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:setMode", input);
}

export async function removeCoopParticipantRemote(input: {
  roomId: string;
  participantId: string;
  targetParticipantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:removeParticipant", input);
}

export async function closeCoopRoomRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:closeRoom", input);
}

export async function heartbeatCoopRoomRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<{ roomId: string; room: CoopRoomView } | null> {
  return call("mutation", "coopFunctions:heartbeat", input);
}

// Server view for a co-op room's shared ending cinematic (trigger/endingId
// nullable, mirroring getSaveCinematics). Adapted to the client's
// `RemoteCinematicView` at this boundary — the same reconciliation cinematicApi
// does for a save's own cinematics.
type CoopCinematicServerView = {
  assetId: string;
  status: RemoteCinematicView["status"];
  trigger: "opening" | "ending" | null;
  endingId: string | null;
  url: string | null;
  hasAudio: boolean;
};

/**
 * Fetch the co-op room's SHARED ending cinematic (Req 10.2), playable by every
 * participant. Returns the single ending cinematic worth surfacing (ready, else
 * in-flight so the four-state UI can upgrade in place), or `null` when the run
 * hasn't reached an ending / the backend is unreachable — callers then render
 * nothing.
 */
export async function getRoomCinematicRemote(input: {
  roomId: string;
  participantId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<RemoteCinematicView | null> {
  const result = await call<{ roomId: string; cinematics: CoopCinematicServerView[] }>(
    "query",
    "coopFunctions:getRoomCinematic",
    input,
  );
  if (!result || !Array.isArray(result.cinematics)) return null;
  const views: RemoteCinematicView[] = result.cinematics
    .filter((v): v is CoopCinematicServerView & { trigger: "opening" | "ending" } => v.trigger !== null)
    .map((v) => ({
      assetId: v.assetId,
      cinematicTrigger: v.trigger,
      status: v.status,
      ...(v.endingId ? { endingId: v.endingId } : {}),
      ...(v.url ? { url: v.url } : {}),
      hasAudio: v.hasAudio === true,
    }));
  return pickEndingCinematic(views);
}

