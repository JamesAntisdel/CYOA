/**
 * Reading-modes Wave 3 — Novel mode "Turn the page" pure logic (R4.6).
 *
 * Novel mode collapses the branch to a single synthetic choice the SERVER
 * stamps onto every non-terminal scene: `{ id: "turn-page", label: "Turn the
 * page" }` (design §2 R4 — "one synthetic choice"). The Novel layout renders
 * that single choice as a page-turn AFFORDANCE (tap/swipe) instead of a
 * `ChoiceList` button row — the affordance changes, not the paint, so it is
 * NOT a sixth cosmetic skin (design §4 Novel page-turn).
 *
 * This module is PURE and TOTAL — no React, no React Native, no timers, no
 * side effects, never throws — so the layout component (`Novel.tsx`, which
 * imports React Native) and its node-`--test` drift guard both import the SAME
 * source of truth. Mirrors the `autoNarrator.ts` / `softSignup.ts` pure-policy
 * pattern.
 *
 * Crucially, the page-turn submits the SERVER-PROVIDED `turn-page` id UNCHANGED
 * through the existing `submitChoice` path (RM10 / R4.6 — `useTurn` is not
 * touched). `resolvePageTurnChoice` never fabricates a choice: it returns the
 * choice the server put on the projection, so the id round-trips exactly. If a
 * novel scene ever arrives with no choices (a 0-choice terminal payload — the
 * novel schema permits `.min(0)`), it returns `null` and the layout renders no
 * affordance (the terminal EndingPanel takes over).
 */

/**
 * The fixed id of the server-stamped synthetic novel choice. Kept in lock-step
 * with the integrator's `completeSceneStream` stamp
 * (`{ id: "turn-page", label: "Turn the page" }`, R4.2/R4.4).
 */
export const PAGE_TURN_CHOICE_ID = "turn-page";

/** Fallback label if the server ever omits one (it always sends "Turn the page"). */
export const PAGE_TURN_FALLBACK_LABEL = "Turn the page";

/** Minimal shape the page-turn reads off a projected choice (a subset of `ChoiceProjection`). */
export type PageTurnChoice = {
  id: string;
  label?: string;
  locked?: boolean;
};

/**
 * Pick the single server-stamped page-turn choice from a novel projection's
 * `choices`. Prefers the explicit `turn-page` id (the contract), falling back
 * to the sole choice for robustness; returns `null` when there is nothing to
 * submit (0-choice terminal payload) so the layout renders no affordance.
 *
 * PURE — returns a reference to the SAME choice object the server sent, so
 * submitting it hands `submitChoice` the unchanged `turn-page` id (R4.6).
 */
export function resolvePageTurnChoice<T extends PageTurnChoice>(
  choices: readonly T[] | null | undefined,
): T | null {
  if (!choices || choices.length === 0) return null;
  const byId = choices.find((choice) => choice.id === PAGE_TURN_CHOICE_ID);
  if (byId) return byId;
  // Robustness: a lone choice under a different id (should not happen given the
  // server stamp) is still a page-turn in novel mode.
  return choices.length === 1 ? (choices[0] ?? null) : null;
}

/**
 * Whether the page-turn affordance may fire right now. Mirrors the guards the
 * `ChoiceList` row it replaces already honors and `submitChoice` self-guards on
 * (RM10): no in-flight stream, no pending choice, a submittable (non-locked)
 * choice present. Re-entrancy is ultimately safe because `submitChoice`
 * self-guards, but gating the affordance avoids a visibly-live-but-dead button.
 */
export function canTurnPage(input: {
  choice: PageTurnChoice | null | undefined;
  isStreaming?: boolean;
  pendingChoiceId?: string | null;
}): boolean {
  const { choice, isStreaming, pendingChoiceId } = input;
  if (!choice) return false;
  if (choice.locked) return false;
  if (isStreaming) return false;
  if (pendingChoiceId != null && pendingChoiceId !== "") return false;
  return true;
}

/** The label to render on the affordance — the server's, or the fallback. */
export function pageTurnLabel(choice: PageTurnChoice | null | undefined): string {
  const label = choice?.label;
  return label && label.trim().length > 0 ? label : PAGE_TURN_FALLBACK_LABEL;
}
