import { describe, expect, it } from "vitest";

import {
  buildPlayTimeAttributionEvent,
  createAuthoredSeedDraft,
  publishAuthoredSeed,
  validateCreatorSeedStory,
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
