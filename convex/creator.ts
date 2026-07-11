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

/**
 * Combined structural + safety validation result, one issue per offending
 * story field. `path` uses the same dotted addressing as
 * `validateCreatorSeedStory` (e.g. `nodes.start.seed`) so clients can map
 * every issue — including content-policy blocks — back onto the form field
 * that produced it. `kind` distinguishes structural problems ("fix the
 * story graph") from safety blocks ("rewrite this text").
 */
export type CreatorSeedSubmissionIssue = {
  path: string;
  message: string;
  kind: "structure" | "safety";
};

export type CreatorSeedSubmissionValidation = {
  valid: boolean;
  issues: CreatorSeedSubmissionIssue[];
};

export type CreatorSeedPolicyEvaluation = {
  summary: ContentPolicySummary;
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

/**
 * Structural validation + per-field policy evaluation in one pass, returning
 * every issue (instead of throwing on the first) so the creator form can
 * highlight all offending fields at once. Used by the `validateSeed` query;
 * the create/update/publish paths run the same checks and throw.
 */
export function validateCreatorSeedSubmission(input: {
  story: Story;
  owner: AccountRecord & { _id: string };
}): CreatorSeedSubmissionValidation {
  const structural: CreatorSeedSubmissionIssue[] = validateCreatorSeedStory(input.story).issues.map(
    (issue) => ({ ...issue, kind: "structure" }),
  );
  const safety: CreatorSeedSubmissionIssue[] = evaluateSeedPolicyByField(
    input.story,
    input.owner,
  ).issues.map((issue) => ({ ...issue, kind: "safety" }));
  const issues = [...structural, ...safety];
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
  const policy = evaluateSeedPolicyByField(input.story, input.owner);
  if (policy.summary.action === "block") {
    throw new AppError("content_blocked", formatBlockedFields(policy));
  }

  return {
    ownerAccountId: input.owner._id,
    title: input.title.trim(),
    status: "draft",
    story: cloneJson(input.story),
    safetySummary: policy.summary,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Re-save an existing draft in place. Mirrors `archiveAuthoredSeed`'s
 * ownership check, then re-runs the same validation + safety gates as
 * `createAuthoredSeedDraft` against the incoming story. Only `draft` seeds
 * are updatable — published/archived seeds are immutable snapshots (a new
 * draft must be created to iterate on them).
 */
export function updateAuthoredSeedDraft(input: {
  seed: AuthoredSeedRecord;
  owner: AccountRecord & { _id: string };
  title: string;
  story: Story;
  now: number;
}): AuthoredSeedRecord {
  if (input.seed.ownerAccountId !== input.owner._id) throw new AppError("creator_seed_forbidden");
  if (input.seed.status !== "draft") throw new AppError("creator_seed_not_draft");
  const validation = validateCreatorSeedStory(input.story);
  if (!validation.valid) throw new AppError("creator_seed_invalid", formatIssues(validation));
  const policy = evaluateSeedPolicyByField(input.story, input.owner);
  if (policy.summary.action === "block") {
    throw new AppError("content_blocked", formatBlockedFields(policy));
  }

  return {
    ...input.seed,
    title: input.title.trim(),
    story: cloneJson(input.story),
    safetySummary: policy.summary,
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
  const policy = evaluateSeedPolicyByField(input.seed.story, input.owner);
  if (policy.summary.action === "block") {
    throw new AppError("content_blocked", formatBlockedFields(policy));
  }

  return {
    ...input.seed,
    status: "published",
    safetySummary: policy.summary,
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

/**
 * Evaluate the content policy one story field at a time (title, node titles,
 * node seeds, choice labels) instead of over one concatenated blob, so a
 * block can name the offending field. The aggregate `summary` unions the
 * per-field categories and blocks when any single field blocks — the same
 * outcome as the old whole-story evaluation (the classifiers are per-phrase
 * and never matched across field boundaries), but now with provenance.
 */
export function evaluateSeedPolicyByField(
  story: Story,
  owner: AccountRecord & { _id: string },
): CreatorSeedPolicyEvaluation {
  const context = {
    accountId: owner._id,
    ageBand: owner.ageBand,
    entitlementTier: "free",
    matureContentEnabled: false,
    surface: "publishing",
  } as const;

  const issues: CreatorSeedPolicyEvaluation["issues"] = [];
  const safetyCategories = new Set<ContentPolicySummary["safetyCategories"][number]>();
  const matureCategories = new Set<ContentPolicySummary["matureCategories"][number]>();
  let blocked = false;
  let redacted = false;

  for (const field of seedPolicyFields(story)) {
    const summary = evaluateTextPolicy({ text: field.text, context });
    for (const category of summary.safetyCategories) safetyCategories.add(category);
    for (const category of summary.matureCategories) matureCategories.add(category);
    if (summary.redacted) redacted = true;
    // On the "publishing" surface the policy only ever emits allow | block.
    if (summary.action !== "allow") {
      blocked = true;
      const categories = [...summary.safetyCategories, ...summary.matureCategories];
      issues.push({
        path: field.path,
        message: `Blocked by content policy (${categories.join(", ") || "policy"})`,
      });
    }
  }

  return {
    summary: {
      action: blocked ? "block" : "allow",
      safetyCategories: [...safetyCategories],
      matureCategories: [...matureCategories],
      redacted,
    },
    issues,
  };
}

function seedPolicyFields(story: Story): Array<{ path: string; text: string }> {
  const fields: Array<{ path: string; text: string }> = [{ path: "title", text: story.title }];
  for (const [nodeId, node] of Object.entries(story.nodes)) {
    if (node.title) fields.push({ path: `nodes.${nodeId}.title`, text: node.title });
    if (node.seed) fields.push({ path: `nodes.${nodeId}.seed`, text: node.seed });
    for (const choice of node.choices) {
      fields.push({ path: `nodes.${nodeId}.choices.${choice.id}.label`, text: choice.label });
    }
  }
  return fields;
}

/**
 * AppError messages are plain strings (the HTTP transport surfaces only
 * `errorMessage`), so the field-level detail rides in the message. The
 * `content_blocked` code stays first for existing substring matchers.
 */
function formatBlockedFields(policy: CreatorSeedPolicyEvaluation): string {
  const detail = policy.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return detail ? `content_blocked: ${detail}` : "content_blocked";
}

function formatIssues(validation: CreatorSeedValidation): string {
  return validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
