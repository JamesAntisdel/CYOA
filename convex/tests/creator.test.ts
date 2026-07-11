import { describe, expect, it } from "vitest";

import {
  buildPlayTimeAttributionEvent,
  createAuthoredSeedDraft,
  evaluateSeedPolicyByField,
  publishAuthoredSeed,
  updateAuthoredSeedDraft,
  validateCreatorSeedStory,
  validateCreatorSeedSubmission,
  type AccountRecord,
} from "../index";
import type { Story } from "@cyoa/engine";

const owner: AccountRecord & { _id: string } = {
  _id: "creator",
  kind: "user",
  ageBand: "18+",
  matureContentEnabled: false,
  createdAt: 1,
  lastActiveAt: 1,
};

const story: Story = {
  id: "seed",
  version: 1,
  title: "Seed",
  startNodeId: "start",
  initialState: { vitality: 3, currency: 0 },
  endings: { end: { id: "end", label: "End", kind: "success" } },
  nodes: {
    start: {
      id: "start",
      seed: "A clean opening.",
      choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
    },
    end: { id: "end", endingId: "end", choices: [] },
  },
};

describe("creator seeds", () => {
  it("validates and publishes authored seed stories", () => {
    expect(validateCreatorSeedStory(story).valid).toBe(true);
    const draft = createAuthoredSeedDraft({ owner, title: "Seed", story, now: 2 });
    const published = publishAuthoredSeed({ seed: draft, owner, now: 3 });

    expect(published.status).toBe("published");
    expect(published.safetySummary.action).toBe("allow");
  });

  it("rejects invalid or unsafe creator seeds", () => {
    expect(validateCreatorSeedStory({ ...story, startNodeId: "missing" }).valid).toBe(false);
    expect(() =>
      createAuthoredSeedDraft({
        owner,
        title: "Unsafe",
        story: {
          ...story,
          nodes: {
            ...story.nodes,
            start: {
              id: "start",
              seed: "you are worthless",
              choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
            },
          },
        },
        now: 2,
      }),
    ).toThrow("content_blocked");
  });

  it("names the offending field when a content block fires", () => {
    const unsafeStory: Story = {
      ...story,
      nodes: {
        ...story.nodes,
        start: {
          id: "start",
          seed: "you are worthless",
          choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
        },
      },
    };

    const policy = evaluateSeedPolicyByField(unsafeStory, owner);
    expect(policy.summary.action).toBe("block");
    expect(policy.summary.safetyCategories).toContain("player_directed_despair");
    expect(policy.issues).toEqual([
      { path: "nodes.start.seed", message: "Blocked by content policy (player_directed_despair)" },
    ]);

    // The thrown AppError message carries the field path (the HTTP transport
    // only surfaces errorMessage strings — no structured payload).
    expect(() => createAuthoredSeedDraft({ owner, title: "Unsafe", story: unsafeStory, now: 2 }))
      .toThrow(/content_blocked: nodes\.start\.seed/);
  });

  it("returns combined structural + safety issues from validateCreatorSeedSubmission", () => {
    const brokenUnsafeStory: Story = {
      ...story,
      title: "you are worthless",
      startNodeId: "missing",
    };

    const result = validateCreatorSeedSubmission({ story: brokenUnsafeStory, owner });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "startNodeId",
      message: "Start node does not exist",
      kind: "structure",
    });
    expect(result.issues).toContainEqual({
      path: "title",
      message: "Blocked by content policy (player_directed_despair)",
      kind: "safety",
    });

    const clean = validateCreatorSeedSubmission({ story, owner });
    expect(clean).toEqual({ valid: true, issues: [] });
  });

  it("updates a draft in place and re-runs the validation + safety gates", () => {
    const draft = { ...createAuthoredSeedDraft({ owner, title: "Seed", story, now: 2 }), _id: "seed-id" };
    const revised: Story = {
      ...story,
      title: "Seed II",
      nodes: {
        ...story.nodes,
        start: {
          id: "start",
          seed: "A revised opening.",
          choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
        },
      },
    };

    const updated = updateAuthoredSeedDraft({ seed: draft, owner, title: "Seed II", story: revised, now: 5 });
    expect(updated.title).toBe("Seed II");
    expect(updated.story.nodes.start?.seed).toBe("A revised opening.");
    expect(updated.status).toBe("draft");
    expect(updated.createdAt).toBe(2);
    expect(updated.updatedAt).toBe(5);

    // Ownership mirror of archiveAuthoredSeed.
    expect(() =>
      updateAuthoredSeedDraft({ seed: draft, owner: { ...owner, _id: "other" }, title: "X", story, now: 5 }),
    ).toThrow("creator_seed_forbidden");
    // Published/archived seeds are immutable snapshots.
    expect(() =>
      updateAuthoredSeedDraft({ seed: { ...draft, status: "published" }, owner, title: "X", story, now: 5 }),
    ).toThrow("creator_seed_not_draft");
    // Structural + safety gates run against the incoming story. (The
    // `creator_seed_invalid` code is on AppError.code; the message carries
    // the flattened path list.)
    expect(() =>
      updateAuthoredSeedDraft({ seed: draft, owner, title: "X", story: { ...story, startNodeId: "missing" }, now: 5 }),
    ).toThrow("startNodeId: Start node does not exist");
    expect(() =>
      updateAuthoredSeedDraft({ seed: draft, owner, title: "X", story: { ...story, title: "you are worthless" }, now: 5 }),
    ).toThrow(/content_blocked: title/);
  });

  it("records play-time attribution without raw prose", () => {
    const seed = { ...createAuthoredSeedDraft({ owner, title: "Seed", story, now: 2 }), _id: "seed-id" };
    const event = buildPlayTimeAttributionEvent({
      seed,
      readerAccountId: "reader",
      seconds: 61.8,
      now: 4,
    });

    expect(event).toEqual({
      eventName: "creator.play_time",
      accountId: "reader",
      storyId: "seed",
      payload: {
        creatorAccountId: "creator",
        authoredSeedId: "seed-id",
        seconds: 61,
      },
      redacted: true,
      createdAt: 4,
    });
  });
});
