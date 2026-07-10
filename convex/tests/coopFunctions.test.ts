// Handler-level tests for the registered co-op wrappers in
// `convex/coopFunctions.ts`. The pure arbitration logic is covered by
// `coop.test.ts`; these exercise the auth + persistence seam with a
// hand-built ctx mock (same style as createSave.test.ts): create a room,
// join a guest by invite, cast votes, resolve the turn, and read state back —
// asserting the coop_rooms doc round-trips and PII stays out of projections.

import { describe, expect, it } from "vitest";

import {
  castVote,
  closeRoom,
  createRoom,
  getRoom,
  getRoomCinematic,
  joinRoom,
  passControl,
  resolveTurn,
} from "../coopFunctions";

type AnyDoc = Record<string, unknown>;

function makeCtx(seed: { docs: AnyDoc[]; entitlements?: AnyDoc[]; assets?: AnyDoc[] }) {
  const docs = new Map<string, AnyDoc>();
  for (const doc of seed.docs) docs.set(String(doc._id), doc);
  let nextId = 1;

  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const source: AnyDoc[] =
          table === "entitlements"
            ? seed.entitlements ?? []
            : table === "assets"
              ? seed.assets ?? []
              : [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          source.filter((row) => constraints.every(([field, value]) => row[field] === value));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        docs.set(id, { ...doc, _id: id });
        return id;
      },
      async patch(id: any, patch: any) {
        const existing = docs.get(String(id));
        // Convex semantics: an explicit `undefined` clears the field.
        const next = { ...(existing ?? {}) } as AnyDoc;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        docs.set(String(id), next);
      },
    },
  };
  return { ctx, docs };
}

function hostAccountDoc(): AnyDoc {
  return {
    _id: "acct_host",
    kind: "guest",
    guestTokenHash: "host_token",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function saveDoc(): AnyDoc {
  return {
    _id: "save_1",
    accountId: "acct_host",
    storyId: "open-canvas",
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
      storyId: "open-canvas",
      path: [],
      delayed: [],
      endingsUnlocked: {},
      npcs: {},
    },
    currentNodeId: "start",
    turnNumber: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function createBaseRoom(mode: "pass" | "vote") {
  const { ctx, docs } = makeCtx({ docs: [hostAccountDoc(), saveDoc()] });
  const created = await (createRoom as any)._handler(ctx, {
    accountId: "acct_host",
    guestTokenHash: "host_token",
    saveId: "save_1",
    mode,
    displayName: "Host Reader",
  });
  return { ctx, docs, created };
}

describe("coopFunctions — room lifecycle", () => {
  it("creates a room, persists it, and hides account ids from the projection", async () => {
    const { docs, created } = await createBaseRoom("vote");

    expect(created.roomId).toMatch(/^coop_rooms_/u);
    expect(created.participantId).toBe("host");
    expect(created.inviteToken).toHaveLength(32);

    const stored = docs.get(created.roomId)!;
    expect(stored.status).toBe("open");
    expect(stored.inviteTokenHash).toHaveLength(64);
    expect(stored.inviteTokenHash).not.toBe(created.inviteToken);

    // Projection is PII-free (Req 20.6).
    expect(JSON.stringify(created.room)).not.toContain("acct_host");
    expect(JSON.stringify(created.room)).not.toContain("host_token");
    expect(created.room.participants[0]).toMatchObject({ role: "host", displayName: "Host Reader" });
  });

  it("lets a guest join by invite and records + resolves a vote", async () => {
    const { ctx, created } = await createBaseRoom("vote");

    const joined = await (joinRoom as any)._handler(ctx, {
      roomId: created.roomId,
      inviteToken: created.inviteToken,
      displayName: "Guest",
      guestTokenHash: "guest_token",
    });
    expect(joined.participantId).toBe("p2");
    expect(joined.room.participants).toHaveLength(2);
    expect(JSON.stringify(joined.room)).not.toContain("guest_token");

    await (castVote as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "host",
      choiceId: "left",
      accountId: "acct_host",
      guestTokenHash: "host_token",
    });
    await (castVote as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "p2",
      choiceId: "left",
      guestTokenHash: "guest_token",
    });

    const resolved = await (resolveTurn as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "host",
      accountId: "acct_host",
      guestTokenHash: "host_token",
    });
    expect(resolved.choiceId).toBe("left");
    // Votes are cleared after resolution.
    expect(resolved.room.participants.every((p: any) => p.hasVoted === false)).toBe(true);
  });

  it("rejects a caller acting as a participant they do not own", async () => {
    const { ctx, created } = await createBaseRoom("vote");
    await (joinRoom as any)._handler(ctx, {
      roomId: created.roomId,
      inviteToken: created.inviteToken,
      displayName: "Guest",
      guestTokenHash: "guest_token",
    });

    await expect(
      (castVote as any)._handler(ctx, {
        roomId: created.roomId,
        participantId: "p2",
        choiceId: "left",
        guestTokenHash: "WRONG_token",
      }),
    ).rejects.toThrow();
  });

  it("advances the controller in pass mode and reads back live state", async () => {
    const { ctx, created } = await createBaseRoom("pass");
    await (joinRoom as any)._handler(ctx, {
      roomId: created.roomId,
      inviteToken: created.inviteToken,
      displayName: "Guest",
      guestTokenHash: "guest_token",
    });

    const passed = await (passControl as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "host",
      accountId: "acct_host",
      guestTokenHash: "host_token",
    });
    expect(passed.room.activeParticipantId).toBe("p2");

    const state = await (getRoom as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "p2",
      guestTokenHash: "guest_token",
    });
    expect(state.room.status).toBe("active");
    expect(state.room.activeParticipantId).toBe("p2");
    expect(Array.isArray(state.choices)).toBe(true);
  });

  it("exposes the shared ending cinematic to any room participant (Req 10.2)", async () => {
    const { ctx, docs } = makeCtx({ docs: [hostAccountDoc(), saveDoc()] });
    const created = await (createRoom as any)._handler(ctx, {
      accountId: "acct_host",
      guestTokenHash: "host_token",
      saveId: "save_1",
      mode: "vote",
      displayName: "Host Reader",
    });
    // Seed a shared ending cinematic on the room's save (produced by game.ts).
    const withCinematic = makeCtx({
      docs: [hostAccountDoc(), saveDoc(), docs.get(created.roomId)!],
      assets: [
        {
          _id: "asset_cine_1",
          saveId: "save_1",
          kind: "cinematic",
          cinematicTrigger: "ending",
          endingId: "ending_start",
          status: "ready",
          url: "https://cdn.example/coop.mp4",
          hasAudio: true,
          createdAt: 20,
        },
        // A different save's cinematic must NOT leak into this room.
        {
          _id: "asset_other",
          saveId: "save_other",
          kind: "cinematic",
          cinematicTrigger: "ending",
          status: "ready",
          url: "https://cdn.example/other.mp4",
          createdAt: 30,
        },
      ],
    });

    // The host reads the shared cinematic.
    const hostView = await (getRoomCinematic as any)._handler(withCinematic.ctx, {
      roomId: created.roomId,
      participantId: "host",
      accountId: "acct_host",
      guestTokenHash: "host_token",
    });
    expect(hostView.roomId).toBe(created.roomId);
    expect(hostView.cinematics).toHaveLength(1);
    expect(hostView.cinematics[0]).toMatchObject({
      assetId: "asset_cine_1",
      trigger: "ending",
      status: "ready",
      url: "https://cdn.example/coop.mp4",
      hasAudio: true,
    });

    // A non-participant caller is rejected.
    await expect(
      (getRoomCinematic as any)._handler(withCinematic.ctx, {
        roomId: created.roomId,
        participantId: "ghost",
        guestTokenHash: "ghost_token",
      }),
    ).rejects.toThrow();
  });

  it("closes a room and blocks further joins", async () => {
    const { ctx, created } = await createBaseRoom("vote");
    const closed = await (closeRoom as any)._handler(ctx, {
      roomId: created.roomId,
      participantId: "host",
      accountId: "acct_host",
      guestTokenHash: "host_token",
    });
    expect(closed.room.status).toBe("closed");

    await expect(
      (joinRoom as any)._handler(ctx, {
        roomId: created.roomId,
        inviteToken: created.inviteToken,
        displayName: "Late",
        guestTokenHash: "late_token",
      }),
    ).rejects.toThrow();
  });
});
