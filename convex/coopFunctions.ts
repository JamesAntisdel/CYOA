import { getStory } from "@cyoa/stories";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import type { AccountRecord } from "./account";
import { loadEntitlementLite } from "./lib/entitlement";
import {
  advancePassTurn,
  assertCanSubmitPassChoice,
  castCoopVote,
  changeCoopMode,
  closeCoopRoom,
  createCoopRoom,
  joinCoopRoom,
  projectCoopRoom,
  recoverCoopHost,
  removeCoopParticipant,
  resolveCoopVote,
  rotateInviteToken,
  touchCoopPresence,
  type CoopJoinIdentity,
  type CoopParticipant,
  type CoopRoomRecord,
} from "./coop";
import { assertAccountSessionAccess } from "./lib/authz";
import { accountFromDoc } from "./lib/docs";
import { AppError, forbidden } from "./lib/errors";
import { projectCurrentScene, readPersistedProposal, type SaveRecord } from "./saves";

const accountId = v.optional(v.id("accounts"));
const requiredAccountId = v.id("accounts");
const saveId = v.id("saves");
const roomId = v.id("coop_rooms");
const guestTokenHash = v.optional(v.string());

/**
 * Registered Convex wrappers for the pure co-op room logic in `convex/coop.ts`
 * (Requirement 20). The pure functions own all arbitration rules; this module
 * only handles auth, room lookup, and persistence to the `coop_rooms` table.
 *
 * Identity model (matches the accountId / guestTokenHash convention used across
 * game.ts / accountFunctions.ts):
 *   - The HOST is always an `accounts` row (guest-kind or user-kind). It owns
 *     the underlying save, so createRoom validates session access + save
 *     ownership.
 *   - A JOINER may present an `accountId` (validated the same way) OR only a
 *     `guestTokenHash` — the URL-invite "read along without an account" path
 *     (Req 20.2). The guest token IS the participant identity; every later
 *     mutation re-checks it against the stored participant.
 *
 * A co-op choice view surfaced by getRoom so the vote / pass UI has options to
 * render. Best-effort: empty when the save's scene can't be projected.
 */
type CoopChoiceView = { choiceId: string; label: string };

export const createRoom = mutationGeneric({
  args: {
    accountId: requiredAccountId,
    guestTokenHash,
    saveId,
    mode: v.union(v.literal("pass"), v.literal("vote")),
    displayName: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("private"), v.literal("link"), v.literal("friends"))),
    spectatorMode: v.optional(v.union(v.literal("off"), v.literal("read_only"))),
    isMature: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);

    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = { ...saveDoc, _id: String(saveDoc._id) } as SaveRecord & { _id: string };

    const entitlement = await loadEntitlement(ctx, args.accountId);
    const now = Date.now();
    const inviteToken = generateInviteToken();
    const record = await createCoopRoom({
      save,
      hostAccount: accountFromDoc(account) as AccountRecord & { _id: string },
      hostEntitlement: entitlement,
      roomCode: generateRoomCode(),
      inviteToken,
      mode: args.mode,
      now,
      ...(args.displayName === undefined ? {} : { displayName: args.displayName }),
      ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      ...(args.spectatorMode === undefined ? {} : { spectatorMode: args.spectatorMode }),
      ...(args.isMature === undefined ? {} : { isMature: args.isMature }),
    });

    const insertedId = await ctx.db.insert("coop_rooms", roomToDbFields(record) as any);
    const stored = { ...record, _id: String(insertedId) };
    return {
      roomId: String(insertedId),
      // Returned ONCE to the host so it can build the invite URL. Only the
      // hash is persisted; the plaintext token is never stored or re-derivable.
      inviteToken,
      participantId: "host",
      room: projectCoopRoom(stored, now, "host"),
    };
  },
});

export const joinRoom = mutationGeneric({
  args: {
    roomId,
    inviteToken: v.string(),
    displayName: v.string(),
    accountId,
    guestTokenHash,
    role: v.optional(v.union(v.literal("player"), v.literal("spectator"))),
  },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    const identity = await buildJoinIdentity(ctx, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const { room: nextRoom, participantId } = await joinCoopRoom({
      room,
      inviteToken: args.inviteToken,
      identity,
      displayName: args.displayName,
      now,
      ...(args.role === undefined ? {} : { role: args.role }),
    });
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      participantId,
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, participantId),
    };
  },
});

export const castVote = mutationGeneric({
  args: { roomId, participantId: v.string(), choiceId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = castCoopVote(room, args.participantId, args.choiceId, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const resolveTurn = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    // Any player may trigger resolution; the pure logic gates on
    // all-votes-in OR an expired timer (Req 20.4). The host resolving a tie is
    // just the same call reaching the deterministic tie-break.
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const { room: nextRoom, choiceId } = resolveCoopVote(room, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      choiceId,
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const passControl = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    // Only the active reader or the host may advance the controller.
    assertCanSubmitPassChoice(room, args.participantId);
    const now = Date.now();
    const nextRoom = advancePassTurn(room, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const recoverHost = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId: requiredAccountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    // Host recovery (Req 20.5): the reclaimer must be the account that owns the
    // room. recoverCoopHost re-checks accountId === hostAccountId internally.
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = recoverCoopHost(room, args.participantId, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const rotateInvite = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const inviteToken = generateInviteToken();
    const nextRoom = await rotateInviteToken(room, args.participantId, inviteToken, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      inviteToken,
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const setMode = mutationGeneric({
  args: {
    roomId,
    participantId: v.string(),
    mode: v.union(v.literal("pass"), v.literal("vote")),
    accountId,
    guestTokenHash,
  },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = changeCoopMode(room, args.participantId, args.mode, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const removeParticipant = mutationGeneric({
  args: {
    roomId,
    participantId: v.string(),
    targetParticipantId: v.string(),
    accountId,
    guestTokenHash,
  },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = removeCoopParticipant(room, args.participantId, args.targetParticipantId, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

export const closeRoom = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = closeCoopRoom(room, args.participantId, now);
    await ctx.db.patch(args.roomId, roomToDbFields(nextRoom) as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

/**
 * Read the live room state + the current scene's votable choices. Auth is
 * MANDATORY: the requester must present a valid identity for a participant
 * already in the room (Req 20.6 — spectators/players see only the projected,
 * PII-free room). `participantId` is required; a caller that can't identify a
 * room participant has no read access, even to a `link`/`private` room.
 * (Presence is refreshed via the separate `heartbeat` mutation — a query
 * cannot patch the room.)
 */
export const getRoom = queryGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const choices = await loadRoomChoices(ctx, room);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...room, _id: String(args.roomId) }, now, args.participantId),
      choices,
    };
  },
});

/**
 * Shared co-op ending cinematic (Req 10.2). A co-op run reaching an ending
 * already triggers an ending cinematic on the SHARED save (wired in game.ts —
 * NOT duplicated here). This query exposes that cinematic as a room-level
 * artifact so ALL participants can play the same "movie of our playthrough".
 * Auth is MANDATORY via the same `assertParticipantAccess` gate as getRoom: a
 * caller must be a room participant. Attributed to the room via the `roomId`
 * envelope; the underlying asset is keyed to the shared save (Build Correction
 * C5), so a repeat playthrough surfaces its own cinematic.
 */
export const getRoomCinematic = queryGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const cinematics = await loadRoomCinematics(ctx, room);
    return { roomId: String(args.roomId), cinematics };
  },
});

/**
 * Presence heartbeat. The client pings this on an interval so `presence`
 * (derived from `lastSeenAt`) stays "online" for participants that are only
 * reading along. Kept separate from getRoom so a passive spectator poll
 * doesn't have to be a mutation.
 */
export const heartbeat = mutationGeneric({
  args: { roomId, participantId: v.string(), accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.roomId);
    await assertParticipantAccess(ctx, room, args.participantId, args.accountId, args.guestTokenHash);
    const now = Date.now();
    const nextRoom = touchCoopPresence(room, args.participantId, now);
    // Presence only mutates `participants[].lastSeenAt`. Patch just that field
    // (+ updatedAt) rather than rewriting the whole room doc every 3s per
    // participant — the full-doc write amplified traffic and needlessly rewrote
    // votes/status/scene fields a heartbeat never touches.
    await ctx.db.patch(args.roomId, {
      participants: nextRoom.participants,
      updatedAt: nextRoom.updatedAt,
    } as any);
    return {
      roomId: String(args.roomId),
      room: projectCoopRoom({ ...nextRoom, _id: String(args.roomId) }, now, args.participantId),
    };
  },
});

// --- helpers ---------------------------------------------------------------

async function loadRoom(
  ctx: { db: { get: (id: any) => Promise<any> } },
  id: unknown,
): Promise<CoopRoomRecord> {
  const doc = await ctx.db.get(id as any);
  if (!doc) throw new AppError("room_not_found");
  return roomFromDoc(doc);
}

function roomFromDoc(doc: Record<string, unknown>): CoopRoomRecord {
  return {
    ...doc,
    _id: String(doc._id),
    isMature: doc.isMature === true,
    participants: (doc.participants ?? []) as CoopParticipant[],
    votes: (doc.votes ?? {}) as Record<string, string>,
  } as CoopRoomRecord;
}

/**
 * Map a pure CoopRoomRecord to the persistable `coop_rooms` columns. Two
 * deliberate omissions driven by the current schema:
 *   - `_id` / `_creationTime` — system fields, never written.
 *   - `closedAt` — no column exists; `status: "closed"` is the source of truth.
 * `isMature` is only written when true so non-mature rooms round-trip against
 * the schema even before the optional `isMature` column is added (see the
 * integrator report). Optional `activeParticipantId` / `voteEndsAt` are passed
 * through as-is so a patch that clears them (e.g. resolveCoopVote) works —
 * Convex clears a field set explicitly to `undefined`.
 */
function roomToDbFields(room: CoopRoomRecord): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    saveId: room.saveId,
    hostAccountId: room.hostAccountId,
    roomCode: room.roomCode,
    inviteTokenHash: room.inviteTokenHash,
    status: room.status,
    mode: room.mode,
    visibility: room.visibility,
    spectatorMode: room.spectatorMode,
    participants: room.participants,
    votes: room.votes,
    activeParticipantId: room.activeParticipantId,
    voteEndsAt: room.voteEndsAt,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
  if (room.isMature) fields.isMature = true;
  return fields;
}

async function buildJoinIdentity(
  ctx: {
    db: { get: (id: any) => Promise<any>; query: (t: any) => any };
    auth: { getUserIdentity: () => Promise<{ subject?: string } | null> };
  },
  accountIdValue: unknown,
  guestTokenHashValue: string | undefined,
): Promise<CoopJoinIdentity> {
  if (accountIdValue) {
    const account = await ctx.db.get(accountIdValue as any);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), guestTokenHashValue);
    const entitlement = await loadEntitlement(ctx, accountIdValue);
    return {
      account: accountFromDoc(account) as AccountRecord & { _id: string },
      entitlement,
      guestTokenHash: guestTokenHashValue,
    };
  }
  if (!guestTokenHashValue) throw new AppError("participant_identity_required");
  return { guestTokenHash: guestTokenHashValue };
}

/**
 * Verify the caller owns the participant they claim to be acting as. Accounts
 * re-run the session-access gate; anonymous guests must present the exact
 * `guestTokenHash` recorded on join. This is what stops one reader from voting
 * or passing the controller as another participant.
 */
async function assertParticipantAccess(
  ctx: {
    db: { get: (id: any) => Promise<any> };
    auth: { getUserIdentity: () => Promise<{ subject?: string } | null> };
  },
  room: CoopRoomRecord,
  participantId: string,
  accountIdValue: unknown,
  guestTokenHashValue: string | undefined,
): Promise<CoopParticipant> {
  const participant = room.participants.find((entry) => entry.participantId === participantId);
  if (!participant) throw new AppError("participant_not_found");
  if (participant.accountId) {
    if (String(accountIdValue ?? "") !== participant.accountId) throw forbidden("participant_mismatch");
    const account = await ctx.db.get(participant.accountId as any);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), guestTokenHashValue);
  } else if (participant.guestTokenHash) {
    if (!guestTokenHashValue || guestTokenHashValue !== participant.guestTokenHash) {
      throw forbidden("participant_mismatch");
    }
  } else {
    throw new AppError("participant_identity_required");
  }
  return participant;
}

const loadEntitlement = loadEntitlementLite;

/**
 * Best-effort projection of the shared save's current votable choices so the
 * co-op vote / pass UI has options to render. Query-safe: reads the save doc
 * WITHOUT migrating it (queries can't patch). Authored stories resolve choices
 * from the engine graph; llm-driven scenes fall back to the persisted scene
 * proposal. Any failure (unknown seed story, version drift) yields `[]`.
 */
async function loadRoomChoices(
  ctx: { db: { get: (id: any) => Promise<any> } },
  room: CoopRoomRecord,
): Promise<CoopChoiceView[]> {
  try {
    const saveDoc = await ctx.db.get(room.saveId as any);
    if (!saveDoc) return [];
    const save = { ...saveDoc, _id: String(saveDoc._id) } as SaveRecord;
    let choices: CoopChoiceView[] = [];
    try {
      const story = getStory(save.storyId);
      choices = projectCurrentScene(save, story)
        .choices.filter((choice) => choice.visibility === "visible")
        .map((choice) => ({ choiceId: choice.choice.id, label: choice.choice.label }));
    } catch {
      choices = [];
    }
    if (choices.length === 0 && save.currentSceneId) {
      const sceneDoc = await ctx.db.get(save.currentSceneId as any);
      const proposal = readPersistedProposal((sceneDoc as { proposal?: unknown } | null)?.proposal);
      if (proposal?.choices) {
        choices = proposal.choices.map((choice) => ({ choiceId: choice.id, label: choice.label }));
      }
    }
    return choices;
  } catch {
    return [];
  }
}

/**
 * The shared-save ending cinematic view for a co-op room. Shape mirrors
 * `getSaveCinematics`'s per-view fields (trigger/endingId nullable) so the
 * client can reuse the same adapter to `RemoteCinematicView`. Only ending
 * cinematics are surfaced — a co-op opening title isn't a shared room moment.
 */
type CoopCinematicView = {
  assetId: string;
  status: "queued" | "generating" | "ready" | "failed" | "blocked";
  trigger: "opening" | "ending" | null;
  endingId: string | null;
  url: string | null;
  hasAudio: boolean;
};

async function loadRoomCinematics(
  ctx: { db: { query: (t: any) => any } },
  room: CoopRoomRecord,
): Promise<CoopCinematicView[]> {
  try {
    const docs = (await ctx.db
      .query("assets")
      .withIndex("by_save_kind", (q: any) => q.eq("saveId", room.saveId).eq("kind", "cinematic"))
      .collect()) as Array<Record<string, any>>;
    return docs
      .filter((d) => d.kind === "cinematic" && d.cinematicTrigger === "ending")
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .map((d) => ({
        assetId: String(d._id),
        status: d.status,
        trigger: (d.cinematicTrigger ?? null) as CoopCinematicView["trigger"],
        endingId: d.endingId ?? null,
        url: typeof d.url === "string" && d.url.length > 0 ? d.url : null,
        hasAudio: d.hasAudio === true,
      }));
  } catch {
    return [];
  }
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

function generateInviteToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
