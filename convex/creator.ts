import type { ContentPolicySummary } from "@cyoa/shared";
import type { Story } from "@cyoa/engine";

import type { AccountRecord } from "./account";
import { evaluateTextPolicy } from "./contentPolicy";
import { AppError } from "./lib/errors";

export type CreatorSeedStatus = "draft" | "published" | "archived";

export type AuthoredSeedRecord = {
  _id?: string;
  ownerAccountId: string;
  title: string;
  status: CreatorSeedStatus;
  story: Story;
  safetySummary: ContentPolicySummary;
  createdAt: number;
  updatedAt: number;
};

export type CreatorSeedValidation = {
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
};

export type CreatorPlayTimeEvent = {
  eventName: "creator.play_time";
  accountId: string;
  storyId: string;
  payload: {
    creatorAccountId: string;
    authoredSeedId?: string;
    seconds: number;
  };
  redacted: true;
  createdAt: number;
};

export function validateCreatorSeedStory(story: Story): CreatorSeedValidation {
  const issues: CreatorSeedValidation["issues"] = [];
  if (!story.id.trim()) issues.push({ path: "id", message: "Story id is required" });
  if (!story.title.trim()) issues.push({ path: "title", message: "Story title is required" });
  if (!Number.isInteger(story.version) || story.version < 1) {
    issues.push({ path: "version", message: "Story version must be a positive integer" });
  }
  if (!story.nodes[story.startNodeId]) {
    issues.push({ path: "startNodeId", message: "Start node does not exist" });
  }
  if (story.deathNodeId && !story.nodes[story.deathNodeId]) {
    issues.push({ path: "deathNodeId", message: "Death node does not exist" });
  }
  for (const [nodeId, node] of Object.entries(story.nodes)) {
    if (node.endingId && !story.endings[node.endingId]) {
      issues.push({ path: `nodes.${nodeId}.endingId`, message: "Ending is not registered" });
    }
    if (!node.endingId && node.choices.length === 0) {
      issues.push({ path: `nodes.${nodeId}.choices`, message: "Non-ending nodes need choices" });
    }
    for (const choice of node.choices) {
      if (!story.nodes[choice.targetNodeId]) {
        issues.push({
          path: `nodes.${nodeId}.choices.${choice.id}.targetNodeId`,
          message: "Choice target node does not exist",
        });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export function createAuthoredSeedDraft(input: {
  owner: AccountRecord & { _id: string };
  title: string;
  story: Story;
  now: number;
}): AuthoredSeedRecord {
  const validation = validateCreatorSeedStory(input.story);
  if (!validation.valid) throw new AppError("creator_seed_invalid", formatIssues(validation));
  const safetySummary = evaluateSeedPolicy(input.story, input.owner);
  if (safetySummary.action === "block") throw new AppError("content_blocked");

  return {
    ownerAccountId: input.owner._id,
    title: input.title.trim(),
    status: "draft",
    story: cloneJson(input.story),
    safetySummary,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function publishAuthoredSeed(input: {
  seed: AuthoredSeedRecord;
  owner: AccountRecord & { _id: string };
  now: number;
}): AuthoredSeedRecord {
  if (input.seed.ownerAccountId !== input.owner._id) throw new AppError("creator_seed_forbidden");
  const validation = validateCreatorSeedStory(input.seed.story);
  if (!validation.valid) throw new AppError("creator_seed_invalid", formatIssues(validation));
  const safetySummary = evaluateSeedPolicy(input.seed.story, input.owner);
  if (safetySummary.action === "block") throw new AppError("content_blocked");

  return {
    ...input.seed,
    status: "published",
    safetySummary,
    updatedAt: input.now,
  };
}

export function archiveAuthoredSeed(input: {
  seed: AuthoredSeedRecord;
  owner: AccountRecord & { _id: string };
  now: number;
}): AuthoredSeedRecord {
  if (input.seed.ownerAccountId !== input.owner._id) throw new AppError("creator_seed_forbidden");
  return { ...input.seed, status: "archived", updatedAt: input.now };
}

export function buildPlayTimeAttributionEvent(input: {
  seed: AuthoredSeedRecord & { _id?: string };
  readerAccountId: string;
  seconds: number;
  now: number;
}): CreatorPlayTimeEvent {
  if (input.seconds <= 0) throw new AppError("play_time_required");
  return {
    eventName: "creator.play_time",
    accountId: input.readerAccountId,
    storyId: input.seed.story.id,
    payload: {
      creatorAccountId: input.seed.ownerAccountId,
      ...(input.seed._id === undefined ? {} : { authoredSeedId: input.seed._id }),
      seconds: Math.floor(input.seconds),
    },
    redacted: true,
    createdAt: input.now,
  };
}

function evaluateSeedPolicy(story: Story, owner: AccountRecord & { _id: string }): ContentPolicySummary {
  return evaluateTextPolicy({
    text: [
      story.title,
      ...Object.values(story.nodes).flatMap((node) => [
        node.title ?? "",
        node.seed ?? "",
        ...node.choices.map((choice) => choice.label),
      ]),
    ].join("\n"),
    context: {
      accountId: owner._id,
      ageBand: owner.ageBand,
      entitlementTier: "free",
      matureContentEnabled: false,
      surface: "publishing",
    },
  });
}

function formatIssues(validation: CreatorSeedValidation): string {
  return validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
