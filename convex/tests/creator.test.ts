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

  it("blocks creator seeds whose gates can never open (dead-key lint, Req 22.2)", () => {
    const gated: Story = {
      ...story,
      nodes: {
        ...story.nodes,
        start: {
          id: "start",
          seed: "A clean opening.",
          choices: [
            {
              id: "go",
              label: "Go",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "ghost_key" }],
            },
          ],
        },
      },
    };

    const validation = validateCreatorSeedStory(gated);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.path).toBe("nodes.start.choices.go.conditions.0");
    expect(validation.issues[0]?.message).toContain('"ghost_key"');

    // The same lint error flows through the field-error contract the drafts
    // shelf renders ({ path, message, kind }) and blocks create/publish.
    const submission = validateCreatorSeedSubmission({ story: gated, owner });
    expect(submission.valid).toBe(false);
    expect(submission.issues).toContainEqual(
      expect.objectContaining({
        path: "nodes.start.choices.go.conditions.0",
        kind: "structure",
      }),
    );
    expect(() => createAuthoredSeedDraft({ owner, title: "Gated", story: gated, now: 2 })).toThrow(
      /ghost_key/u,
    );
  });

  it("flags grant-vs-gate spelling drift, citing both spellings", () => {
    const drifted: Story = {
      ...story,
      nodes: {
        start: {
          id: "start",
          seed: "A clean opening.",
          choices: [
            {
              id: "grab",
              label: "Grab the key",
              targetNodeId: "hall",
              effects: [
                { kind: "inventory_add", item: { id: "bone_key", label: "Bone Key" } },
              ],
            },
          ],
        },
        hall: {
          id: "hall",
          seed: "A locked door.",
          choices: [
            {
              id: "open",
              label: "Open the door",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "Bone-Key" }],
            },
          ],
        },
        end: { id: "end", endingId: "end", choices: [] },
      },
    };

    const validation = validateCreatorSeedStory(drifted);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.path).toBe("nodes.hall.choices.open.conditions.0");
    // Both spellings are cited so the creator knows what to reconcile —
    // authored seeds play under STRICT id matching, not the LLM path's fuzz.
    expect(validation.issues[0]?.message).toContain('"Bone-Key"');
    expect(validation.issues[0]?.message).toContain('"bone_key"');
  });

  it("keeps advisory lint warnings non-blocking for creators", () => {
    const warned: Story = {
      ...story,
      initialState: {
        vitality: 3,
        currency: 0,
        attributes: {
          resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "visible" },
        },
      },
      nodes: {
        ...story.nodes,
        start: {
          id: "start",
          seed: "A clean opening.",
          choices: [
            {
              id: "go",
              label: "Go",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_least", statId: "resolve", value: 99 }],
            },
          ],
        },
      },
    };

    // Unreachable stat thresholds are a lint WARNING (severity below error):
    // they must not block drafts or publishing through this contract.
    expect(validateCreatorSeedStory(warned).valid).toBe(true);
    expect(validateCreatorSeedSubmission({ story: warned, owner })).toEqual({
      valid: true,
      issues: [],
    });
    expect(createAuthoredSeedDraft({ owner, title: "Warned", story: warned, now: 2 }).status).toBe(
      "draft",
    );
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
