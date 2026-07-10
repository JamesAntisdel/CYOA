import { describe, expect, it } from "vitest";

import {
  buildForkPlan,
  projectReadAlong,
  publishTaleSnapshot,
  revokeTale,
  snapshotTurn,
  updateTaleMetadata,
  type AccountRecord,
  type SaveRecord,
  type TurnHistoryRecord,
} from "../index";

const account: AccountRecord & { _id: string } = {
  _id: "acct",
  kind: "user",
  ageBand: "18+",
  matureContentEnabled: false,
  createdAt: 1,
  lastActiveAt: 1,
};

const save: SaveRecord & { _id: string } = {
  _id: "save",
  accountId: "acct",
  storyId: "story",
  mode: "story",
  status: "active",
  engineVersion: 1,
  storyVersion: 1,
  state: {
    storyId: "story",
    mode: "story",
    vitality: 5,
    currency: 0,
    attributes: {},
    inventory: [],
    flags: {},
    currentNodeId: "start",
    turnNumber: 1,
    path: ["start"],
    delayed: [],
    endingsUnlocked: {},
    schemaVersion: 1,
    npcs: {},
  },
  currentNodeId: "start",
  turnNumber: 1,
  createdAt: 1,
  updatedAt: 1,
};

const history: TurnHistoryRecord = {
  saveId: "save",
  accountId: "acct",
  requestId: "request-1",
  turnNumber: 1,
  fromNodeId: "start",
  choiceId: "open",
  engineDiffs: [{ kind: "node", target: "hall", delta: 1 }],
  engineEvents: [{ kind: "choice_applied", choiceId: "open" }],
  provider: "deterministic",
  latency: { engineMs: 1, llmMs: 0 },
  createdAt: 2,
};

describe("published tales", () => {
  it("publishes immutable snapshots and metadata edits do not rewrite turns", () => {
    const turn = snapshotTurn({
      sourceTurnId: "turn-1",
      history,
      prose: "The door opens.",
      choices: [{ choiceId: "open", label: "Open the door" }],
      stateAfter: { currentNodeId: "hall" },
    });
    const tale = publishTaleSnapshot({
      owner: account,
      entitlement: null,
      save,
      title: "Door",
      synopsis: "A small door.",
      privacy: "public",
      forkPolicy: "any_decision",
      turns: [turn],
      now: 3,
    });

    turn.prose = "changed outside";
    const updated = updateTaleMetadata(tale, { title: "New Door", now: 4 });

    expect(tale.snapshotTurns[0]?.prose).toBe("The door opens.");
    expect(updated.snapshotTurns).toEqual(tale.snapshotTurns);
    expect(updated.title).toBe("New Door");
  });

  it("stops read-along immediately after revocation", () => {
    const tale = publishTaleSnapshot({
      owner: account,
      entitlement: null,
      save,
      title: "Door",
      synopsis: "A small door.",
      privacy: "unlisted",
      forkPolicy: "any_decision",
      turns: [
        snapshotTurn({
          sourceTurnId: "turn-1",
          history,
          prose: "The door opens.",
          choices: [],
          stateAfter: {},
        }),
      ],
      now: 3,
    });

    expect(projectReadAlong({ tale, now: 4 }).readOnly).toBe(true);
    expect(() => projectReadAlong({ tale: revokeTale(tale, 5), now: 6 })).toThrow("tale_revoked");
  });

  it("reruns policy gates before publishing and forking", () => {
    expect(() =>
      publishTaleSnapshot({
        owner: account,
        entitlement: null,
        save,
        title: "Blocked",
        synopsis: "you are worthless",
        privacy: "public",
        forkPolicy: "any_decision",
        turns: [
          snapshotTurn({
            sourceTurnId: "turn-1",
            history,
            prose: "The door opens.",
            choices: [],
            stateAfter: {},
          }),
        ],
        now: 3,
      }),
    ).toThrow("content_blocked");
  });

  it("builds fork plans from allowed decisions", () => {
    const tale = {
      ...publishTaleSnapshot({
        owner: account,
        entitlement: null,
        save,
        title: "Door",
        synopsis: "A small door.",
        privacy: "public",
        forkPolicy: "any_decision",
        turns: [
          snapshotTurn({
            sourceTurnId: "turn-1",
            history,
            prose: "The door opens.",
            choices: [],
            stateAfter: { currentNodeId: "hall" },
          }),
        ],
        now: 3,
      }),
      _id: "tale",
    };

    const fork = buildForkPlan({
      tale,
      sourceTurnId: "turn-1",
      account,
      entitlement: null,
      now: 4,
    });

    expect(fork).toMatchObject({
      taleId: "tale",
      sourceTurnId: "turn-1",
      storyId: "story",
      startingState: { currentNodeId: "hall" },
    });
    expect(fork.attributionEvent.eventName).toBe("tale.forked");
  });
});
