import { describe, expect, it } from "vitest";

import type { AccountRecord } from "../account";
import type { EntitlementRecord } from "../billing/entitlements";
import {
  advancePassTurn,
  assertCanSubmitPassChoice,
  castCoopVote,
  changeCoopMode,
  closeCoopRoom,
  createCoopRoom,
  hashInviteToken,
  joinCoopRoom,
  projectCoopRoom,
  recoverCoopHost,
  removeCoopParticipant,
  resolveCoopVote,
  rotateInviteToken,
} from "../coop";
import type { SaveRecord } from "../saves";

const host: AccountRecord & { _id: string } = {
  _id: "acct_host",
  kind: "user",
  userId: "user_host",
  ageBand: "18+",
  matureContentEnabled: true,
  matureContentEnabledAt: 1,
  createdAt: 1,
  lastActiveAt: 1,
};

const paid: Pick<EntitlementRecord, "tier" | "status"> = {
  tier: "unlimited",
  status: "active",
};

const save: SaveRecord & { _id: string } = {
  _id: "save_1",
  accountId: "acct_host",
  storyId: "story",
  mode: "story",
  status: "active",
  engineVersion: 1,
  storyVersion: 1,
  state: {
    schemaVersion: 1,
    mode: "story",
    currentNodeId: "start",
    turnNumber: 0,
    vitality: 10,
    currency: 0,
    attributes: {},
    inventory: [],
    flags: {},
    storyId: "story",
    path: [],
    delayed: [],
    endingsUnlocked: {},
  },
  currentNodeId: "start",
  turnNumber: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe("co-op rooms", () => {
  it("creates rooms with hashed invite tokens and projected participant records", async () => {
    const room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "ABCD",
      inviteToken: "invite-token-123456",
      mode: "pass",
      now: 1_000,
      displayName: "Host Reader",
    });

    expect(room.inviteTokenHash).toHaveLength(64);
    expect(room.inviteTokenHash).not.toBe("invite-token-123456");
    expect(room.activeParticipantId).toBe("host");

    const projection = projectCoopRoom(room, 1_200);
    expect(projection.participants).toEqual([
      {
        participantId: "host",
        displayName: "Host Reader",
        avatarInitial: "H",
        role: "host",
        presence: "online",
        hasVoted: false,
      },
    ]);
    expect(JSON.stringify(projection)).not.toContain("acct_host");
    expect(JSON.stringify(projection)).not.toContain("matureContentEnabled");
  });

  it("joins players and spectators without exposing guest hashes", async () => {
    let room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "EFGH",
      inviteToken: "invite-token-abcdef",
      mode: "pass",
      now: 1_000,
    });

    const joined = await joinCoopRoom({
      room,
      inviteToken: "invite-token-abcdef",
      identity: { guestTokenHash: "guest_hash_private" },
      displayName: "Guest",
      now: 2_000,
    });
    room = joined.room;

    const spectator = await joinCoopRoom({
      room,
      inviteToken: "invite-token-abcdef",
      identity: { guestTokenHash: "spectator_hash_private" },
      displayName: "Watcher",
      now: 2_100,
      role: "spectator",
    });

    expect(spectator.room.participants).toHaveLength(3);
    const projection = projectCoopRoom(spectator.room, 2_200);
    expect(projection.participants.map((participant) => participant.role)).toEqual([
      "host",
      "player",
      "spectator",
    ]);
    expect(JSON.stringify(projection)).not.toContain("guest_hash_private");
    expect(JSON.stringify(projection)).not.toContain("spectator_hash_private");
  });

  it("enforces pass mode active participant while host can recover control", async () => {
    let room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "PASS",
      inviteToken: "invite-token-pass-1",
      mode: "pass",
      now: 1_000,
    });
    room = (await joinCoopRoom({
      room,
      inviteToken: "invite-token-pass-1",
      identity: { guestTokenHash: "guest_hash" },
      displayName: "Guest",
      now: 1_100,
    })).room;

    assertCanSubmitPassChoice(room, "host");
    room = advancePassTurn(room, 1_200);
    expect(room.activeParticipantId).not.toBe("host");
    expect(() => assertCanSubmitPassChoice(room, "host")).not.toThrow();
    expect(() => assertCanSubmitPassChoice(room, "missing")).toThrow("participant_not_found");

    const recovered = recoverCoopHost(room, "host", 1_300);
    expect(recovered.participants.find((participant) => participant.participantId === "host")?.role).toBe("host");
  });

  it("records vote mode votes and resolves by full vote or expired timer", async () => {
    let room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "VOTE",
      inviteToken: "invite-token-vote-1",
      mode: "vote",
      now: 1_000,
    });
    const joined = await joinCoopRoom({
      room,
      inviteToken: "invite-token-vote-1",
      identity: { guestTokenHash: "guest_hash" },
      displayName: "Guest",
      now: 1_100,
    });
    room = castCoopVote(joined.room, "host", "left", 1_200);
    room = castCoopVote(room, joined.participantId, "right", 1_300);

    const resolved = resolveCoopVote(room, 1_400);
    expect(resolved.choiceId).toBe("left");
    expect(resolved.room.votes).toEqual({});
  });

  it("rotates invites, removes participants, changes modes, and closes rooms", async () => {
    let room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "CTRL",
      inviteToken: "invite-token-old-1",
      mode: "vote",
      now: 1_000,
    });
    const joined = await joinCoopRoom({
      room,
      inviteToken: "invite-token-old-1",
      identity: { guestTokenHash: "guest_hash" },
      displayName: "Guest",
      now: 1_100,
    });
    room = await rotateInviteToken(joined.room, "host", "invite-token-new-1", 1_200);

    await expect(joinCoopRoom({
      room,
      inviteToken: "invite-token-old-1",
      identity: { guestTokenHash: "late_guest" },
      displayName: "Late",
      now: 1_300,
    })).rejects.toThrow("invite_invalid");
    expect(room.inviteTokenHash).toBe(await hashInviteToken("invite-token-new-1"));

    room = removeCoopParticipant(room, "host", joined.participantId, 1_400);
    expect(room.participants).toHaveLength(1);
    room = changeCoopMode(room, "host", "pass", 1_500);
    expect(room.activeParticipantId).toBe("host");
    room = closeCoopRoom(room, "host", 1_600);
    expect(room.status).toBe("closed");
  });

  it("requires every mature-room participant to be eligible", async () => {
    const room = await createCoopRoom({
      save,
      hostAccount: host,
      hostEntitlement: paid,
      roomCode: "MATR",
      inviteToken: "invite-token-mature-1",
      mode: "vote",
      now: 1_000,
      isMature: true,
    });

    await expect(joinCoopRoom({
      room,
      inviteToken: "invite-token-mature-1",
      identity: { guestTokenHash: "guest_hash" },
      displayName: "Guest",
      now: 1_100,
    })).rejects.toThrow("mature_room_not_allowed");

    const eligibleAccount: AccountRecord & { _id: string } = {
      ...host,
      _id: "acct_friend",
      userId: "user_friend",
    };
    await expect(joinCoopRoom({
      room,
      inviteToken: "invite-token-mature-1",
      identity: { account: eligibleAccount, entitlement: paid },
      displayName: "Friend",
      now: 1_200,
    })).resolves.toMatchObject({ participantId: "p2" });
  });
});
