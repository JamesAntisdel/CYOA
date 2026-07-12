import { normalizeItemRef, VITALITY_MAX, VITALITY_MIN } from "@cyoa/engine";
import type { Choice, Condition, Effect, Story } from "@cyoa/engine";

/**
 * Dead-key / reachability linter for authored + creator story graphs
 * (core-read-loop Req 22.2 — "validate against engine schemas before making
 * it launchable"). Structural validation (validate.ts / convex creator.ts)
 * proves every referenced node exists; this module proves every GATE can
 * actually open: a `has_item` condition is only honest if some path from the
 * start node grants that exact item id before the reader stands in front of
 * the door. The authored runtime uses STRICT id matching (`hasItem`,
 * engine/visibility.ts), so even a spelling drift between grant and gate
 * soft-locks the story — the LLM path's `hasItemTolerant` fuzziness does NOT
 * apply here, which is exactly the trap this lint catches.
 *
 * Approach: a fixpoint worklist over the story graph from `startNodeId`
 * computing, per node, the optimistic union of everything ANY path into that
 * node could have granted — item ids (plus normalized spellings for the
 * fuzzy-drift diagnosis), flag values, and per-stat optimistic upper/lower
 * bounds (positive deltas only for the max, negative only for the min,
 * clamped by declared attribute bounds). Cycles that keep growing a stat are
 * widened to ±Infinity after a bounded number of re-visits so the analysis
 * always converges; a defensive hard iteration cap backstops it. Optimism is
 * deliberate: it can only under-report (a gate we flag as dead is PROVABLY
 * dead on every path), never false-positive a winnable gate.
 *
 * Pure module — no logging, no clock; safe for both the stories package and
 * the convex creator validation path.
 */

export type StoryLintSeverity = "error" | "warning" | "info";

export type StoryLintCode =
  | "dead_item_gate"
  | "fuzzy_item_gate"
  | "dead_flag_gate"
  | "unreachable_stat_gate"
  | "trivial_missing_item";

export type StoryLintIssue = {
  /** Dotted story addressing, e.g. `nodes.hall.choices.open.conditions.0`. */
  path: string;
  /** Creator-actionable text naming the node, choice, and missing grant. */
  message: string;
  severity: StoryLintSeverity;
  code: StoryLintCode;
};

type FlagValue = boolean | number | string;

/**
 * The optimistic grant-union for one node: everything some path from the
 * start node could have granted by the time the reader is choosing here
 * (including this node's own `effectsOnEnter`, which run before choices).
 */
type GrantSummary = {
  /** Exact item ids grantable (strict `hasItem` compares `id ===`). */
  itemIds: Set<string>;
  /** normalizeItemRef(id|label) → the original spellings that produce it. */
  itemSpellings: Map<string, Set<string>>;
  /** flag → every literal value some path sets it to (incl. initial flags). */
  flagValues: Map<string, Set<FlagValue>>;
  /** stat → optimistic max attainable (positive deltas only, clamped). */
  statMax: Map<string, number>;
  /** stat → optimistic min attainable (negative deltas only, clamped). */
  statMin: Map<string, number>;
};

export function lintStoryGates(story: Story): StoryLintIssue[] {
  const issues: StoryLintIssue[] = [];
  const summaries = computeReachableGrantSummaries(story);

  for (const [nodeId, node] of Object.entries(story.nodes)) {
    const summary = summaries.get(nodeId);
    // Unreachable from start (or start itself is missing): grants along a
    // path are undefined, and structural validation owns node-existence
    // complaints — gate-lint only speaks about nodes a reader can stand in.
    if (!summary) continue;
    for (const choice of node.choices) {
      // Statically-hidden choices can never be taken (visibility.ts
      // short-circuits configured "hidden" before conditions run), so their
      // gates are unreactable dead weight but not soft-locks — skip them.
      if ((choice.visibility ?? "visible") === "hidden") continue;
      (choice.conditions ?? []).forEach((condition, index) => {
        lintCondition({ story, summary, nodeId, choice, condition, index, issues });
      });
    }
  }

  return issues;
}

function lintCondition(input: {
  story: Story;
  summary: GrantSummary;
  nodeId: string;
  choice: Choice;
  condition: Condition;
  index: number;
  issues: StoryLintIssue[];
}): void {
  const { story, summary, nodeId, choice, condition, index, issues } = input;
  const path = `nodes.${nodeId}.choices.${choice.id}.conditions.${index}`;
  const where = `Choice "${choice.label}" (node "${nodeId}")`;

  switch (condition.kind) {
    case "has_item": {
      if (summary.itemIds.has(condition.itemId)) return;
      const spellings = summary.itemSpellings.get(normalizeItemRef(condition.itemId));
      if (spellings && spellings.size > 0) {
        issues.push({
          path,
          severity: "error",
          code: "fuzzy_item_gate",
          message:
            `${where} requires item "${condition.itemId}", but every path to this node only ` +
            `grants it spelled ${citeSpellings(spellings)}. Authored stories match item ids ` +
            `exactly (no fuzzy matching at play time), so this gate can never open — rename the ` +
            `condition's itemId (or the granted item's id) so the spellings match.`,
        });
        return;
      }
      issues.push({
        path,
        severity: "error",
        code: "dead_item_gate",
        message:
          `${where} requires item "${condition.itemId}", but no path from "${story.startNodeId}" ` +
          `to this node ever grants it — the choice can never unlock. Add an inventory_add ` +
          `effect granting "${condition.itemId}" on a route into this node, or remove the gate.`,
      });
      return;
    }
    case "missing_item": {
      if (summary.itemIds.has(condition.itemId)) return;
      const spellings = summary.itemSpellings.get(normalizeItemRef(condition.itemId));
      const fuzzyHint =
        spellings && spellings.size > 0
          ? ` (grants spelled ${citeSpellings(spellings)} do not count — the check matches ids exactly)`
          : "";
      issues.push({
        path,
        severity: "info",
        code: "trivial_missing_item",
        message:
          `${where} has a missing_item condition on "${condition.itemId}", but no path to this ` +
          `node ever grants that item, so the condition is always true and can be removed${fuzzyHint}.`,
      });
      return;
    }
    case "flag_equals": {
      const values = summary.flagValues.get(condition.flag);
      if (!values) {
        issues.push({
          path,
          severity: "error",
          code: "dead_flag_gate",
          message:
            `${where} gates on flag "${condition.flag}" = ${JSON.stringify(condition.value)}, ` +
            `but no path to this node ever sets that flag (and it is not in the story's initial ` +
            `flags) — the choice can never unlock. Add a flag_set effect for ` +
            `"${condition.flag}" on a route into this node.`,
        });
        return;
      }
      if (!values.has(condition.value)) {
        const observed = [...values].map((value) => JSON.stringify(value)).join(", ");
        issues.push({
          path,
          severity: "error",
          code: "dead_flag_gate",
          message:
            `${where} gates on flag "${condition.flag}" = ${JSON.stringify(condition.value)}, ` +
            `but paths to this node only ever set it to ${observed} — the comparison is exact, ` +
            `so the choice can never unlock. Set the flag to ` +
            `${JSON.stringify(condition.value)} somewhere, or fix the gate's value.`,
        });
      }
      return;
    }
    case "stat_at_least": {
      const upper = summary.statMax.get(condition.statId) ?? initialStatValue(story, condition.statId);
      if (upper < condition.value) {
        issues.push({
          path,
          severity: "warning",
          code: "unreachable_stat_gate",
          message:
            `${where} requires stat "${condition.statId}" >= ${condition.value}, but the highest ` +
            `value attainable on any path to this node is ${upper}. Lower the threshold or add ` +
            `positive "${condition.statId}" effects on routes into this node.`,
        });
      }
      return;
    }
    case "stat_at_most": {
      const lower = summary.statMin.get(condition.statId) ?? initialStatValue(story, condition.statId);
      if (lower > condition.value) {
        issues.push({
          path,
          severity: "warning",
          code: "unreachable_stat_gate",
          message:
            `${where} requires stat "${condition.statId}" <= ${condition.value}, but the lowest ` +
            `value attainable on any path to this node is ${lower}. Raise the threshold or add ` +
            `negative "${condition.statId}" effects on routes into this node.`,
        });
      }
      return;
    }
    // "always" and "mode_is" gates need no grant — nothing to lint.
    default:
      return;
  }
}

/**
 * Fixpoint BFS from `startNodeId`. Returns a summary for every node reachable
 * through non-hidden choices whose targets exist; missing start node → empty
 * map (structural validation reports that separately, and with no reachable
 * nodes the lint deliberately stays silent rather than guessing).
 */
function computeReachableGrantSummaries(story: Story): Map<string, GrantSummary> {
  const summaries = new Map<string, GrantSummary>();
  const start = story.nodes[story.startNodeId];
  if (!start) return summaries;

  const startSummary = emptySummary();
  for (const item of story.initialState.inventory ?? []) {
    startSummary.itemIds.add(item.id);
    addSpelling(startSummary, item.id);
    addSpelling(startSummary, item.label);
  }
  for (const [flag, value] of Object.entries(story.initialState.flags ?? {})) {
    startSummary.flagValues.set(flag, new Set([value]));
  }
  applyEffectsToSummary(story, startSummary, start.effectsOnEnter);
  summaries.set(story.startNodeId, startSummary);

  const nodeCount = Object.keys(story.nodes).length;
  // After this many distinct re-updates of one node's summary, any stat bound
  // still moving is on a productive cycle — widen it to ±Infinity so the
  // fixpoint converges ("the reader can lap this loop as often as they like").
  const widenAfter = nodeCount * 2 + 8;
  // Defensive hard cap (sets are finite and widening makes stat bounds
  // absorbing, so this is unreachable in practice — it bounds the damage of
  // any future effect kind that violates those assumptions).
  const maxIterations = (widenAfter + 8) * (nodeCount + 4) * (nodeCount + 4);
  const updateCounts = new Map<string, number>();
  const queue: string[] = [story.startNodeId];

  for (let iteration = 0; queue.length > 0 && iteration < maxIterations; iteration += 1) {
    const nodeId = queue.shift() as string;
    const node = story.nodes[nodeId] as Story["nodes"][string];
    const summary = summaries.get(nodeId) as GrantSummary;

    for (const choice of node.choices) {
      // A configured-hidden choice can never be taken, so its effects never
      // apply and its target is not reachable through it.
      if ((choice.visibility ?? "visible") === "hidden") continue;
      const target = story.nodes[choice.targetNodeId];
      // Dangling target: structural validation owns the complaint; the lint
      // just doesn't walk through the hole (under-reporting, never lying).
      if (!target) continue;

      const carried = cloneSummary(summary);
      applyEffectsToSummary(story, carried, choice.effects);
      // effectsOnEnter run on entering the target, before its choices render,
      // so they belong to the target's pre-choice summary.
      applyEffectsToSummary(story, carried, target.effectsOnEnter);

      const existing = summaries.get(choice.targetNodeId);
      if (!existing) {
        summaries.set(choice.targetNodeId, carried);
        queue.push(choice.targetNodeId);
        continue;
      }

      const merge = mergeSummaryInto(existing, carried);
      if (!merge.changed) continue;
      const updates = (updateCounts.get(choice.targetNodeId) ?? 0) + 1;
      updateCounts.set(choice.targetNodeId, updates);
      if (updates > widenAfter) {
        for (const statId of merge.grownMax) existing.statMax.set(statId, Number.POSITIVE_INFINITY);
        for (const statId of merge.grownMin) existing.statMin.set(statId, Number.NEGATIVE_INFINITY);
      }
      if (!queue.includes(choice.targetNodeId)) queue.push(choice.targetNodeId);
    }
  }

  return summaries;
}

/**
 * Fold an effect list (recursing into `delayed` bundles — a scheduled grant
 * WILL fire once enough nodes pass, so optimistically it counts the moment it
 * is scheduled) into a summary, in place. Removal effects (`inventory_remove`,
 * `flag_unset`) are deliberately ignored: the union is optimistic, and a
 * reader on some other path may still hold the grant.
 */
function applyEffectsToSummary(
  story: Story,
  summary: GrantSummary,
  effects: readonly Effect[] | undefined,
): void {
  for (const effect of effects ?? []) {
    switch (effect.kind) {
      case "inventory_add": {
        summary.itemIds.add(effect.item.id);
        addSpelling(summary, effect.item.id);
        addSpelling(summary, effect.item.label);
        break;
      }
      case "flag_set": {
        const values = summary.flagValues.get(effect.flag) ?? new Set<FlagValue>();
        values.add(effect.value);
        summary.flagValues.set(effect.flag, values);
        break;
      }
      case "stat": {
        const clampBounds = statClamp(story, effect.statId);
        if (effect.delta > 0) {
          const current =
            summary.statMax.get(effect.statId) ?? initialStatValue(story, effect.statId);
          summary.statMax.set(effect.statId, clampTop(current + effect.delta, clampBounds.max));
        } else if (effect.delta < 0) {
          const current =
            summary.statMin.get(effect.statId) ?? initialStatValue(story, effect.statId);
          summary.statMin.set(effect.statId, clampBottom(current + effect.delta, clampBounds.min));
        }
        break;
      }
      case "delayed": {
        applyEffectsToSummary(story, summary, effect.effects);
        break;
      }
      // currency / inventory_remove / flag_unset / npc_* / skill_check never
      // grant anything a Condition can gate on.
      default:
        break;
    }
  }
}

/**
 * Union `source` into `target` in place. Reports whether anything changed and
 * WHICH stat bounds moved, so the caller can widen exactly the bounds that
 * are still growing on a cycle.
 */
function mergeSummaryInto(
  target: GrantSummary,
  source: GrantSummary,
): { changed: boolean; grownMax: string[]; grownMin: string[] } {
  let changed = false;

  for (const id of source.itemIds) {
    if (target.itemIds.has(id)) continue;
    target.itemIds.add(id);
    changed = true;
  }
  for (const [ref, spellings] of source.itemSpellings) {
    const existing = target.itemSpellings.get(ref) ?? new Set<string>();
    for (const spelling of spellings) {
      if (existing.has(spelling)) continue;
      existing.add(spelling);
      changed = true;
    }
    target.itemSpellings.set(ref, existing);
  }
  for (const [flag, values] of source.flagValues) {
    const existing = target.flagValues.get(flag) ?? new Set<FlagValue>();
    for (const value of values) {
      if (existing.has(value)) continue;
      existing.add(value);
      changed = true;
    }
    target.flagValues.set(flag, existing);
  }

  const grownMax: string[] = [];
  for (const [statId, value] of source.statMax) {
    const current = target.statMax.get(statId);
    if (current !== undefined && value <= current) continue;
    target.statMax.set(statId, value);
    grownMax.push(statId);
    changed = true;
  }
  const grownMin: string[] = [];
  for (const [statId, value] of source.statMin) {
    const current = target.statMin.get(statId);
    if (current !== undefined && value >= current) continue;
    target.statMin.set(statId, value);
    grownMin.push(statId);
    changed = true;
  }

  return { changed, grownMax, grownMin };
}

function emptySummary(): GrantSummary {
  return {
    itemIds: new Set(),
    itemSpellings: new Map(),
    flagValues: new Map(),
    statMax: new Map(),
    statMin: new Map(),
  };
}

function cloneSummary(summary: GrantSummary): GrantSummary {
  return {
    itemIds: new Set(summary.itemIds),
    itemSpellings: new Map(
      [...summary.itemSpellings].map(([ref, spellings]) => [ref, new Set(spellings)]),
    ),
    flagValues: new Map([...summary.flagValues].map(([flag, values]) => [flag, new Set(values)])),
    statMax: new Map(summary.statMax),
    statMin: new Map(summary.statMin),
  };
}

function addSpelling(summary: GrantSummary, spelling: string): void {
  const ref = normalizeItemRef(spelling);
  // Pure-punctuation spellings normalize to "" — never a meaningful match key.
  if (ref.length === 0) return;
  const spellings = summary.itemSpellings.get(ref) ?? new Set<string>();
  spellings.add(spelling);
  summary.itemSpellings.set(ref, spellings);
}

function initialStatValue(story: Story, statId: string): number {
  if (statId === "vitality") return story.initialState.vitality;
  return story.initialState.attributes?.[statId]?.value ?? 0;
}

/**
 * Declared clamp bounds for a stat, mirroring the engine's `applyStatDelta`:
 * vitality is pinned to [VITALITY_MIN, VITALITY_MAX]; declared attributes use
 * their own min/max; undeclared attributes are unbounded (the engine creates
 * them clamp-free on first delta).
 */
function statClamp(
  story: Story,
  statId: string,
): { min: number | undefined; max: number | undefined } {
  if (statId === "vitality") return { min: VITALITY_MIN, max: VITALITY_MAX };
  const attribute = story.initialState.attributes?.[statId];
  return { min: attribute?.min, max: attribute?.max };
}

function clampTop(value: number, max: number | undefined): number {
  return max === undefined ? value : Math.min(value, max);
}

function clampBottom(value: number, min: number | undefined): number {
  return min === undefined ? value : Math.max(value, min);
}

function citeSpellings(spellings: ReadonlySet<string>): string {
  return [...spellings].map((spelling) => `"${spelling}"`).join(", ");
}
