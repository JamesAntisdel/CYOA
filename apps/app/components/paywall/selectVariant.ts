import type {
  PaywallSelectionInput,
  PaywallVariantKind,
} from "./types";

/**
 * Choose which paywall surface to render based on candle/turns state.
 *
 * - **Soft**: today's candle has fully burned. The reader hit the cap;
 *   show a blocking modal that closes the book until tomorrow.
 * - **Inline**: the reader is at the last available turn (or already
 *   past it for an uncapped tier requesting a Pro feature like media).
 *   The paywall slots into the next scene position rather than
 *   covering the page.
 * - **TopBar**: turns remain but the reader is approaching the cap, or
 *   they are exploring a non-blocking upsell. A thin ribbon nudges
 *   without disrupting flow.
 *
 * Exactly one variant fires for a given input.
 */
export function selectPaywallVariant(input: PaywallSelectionInput): PaywallVariantKind {
  const { candle, reason } = input;

  // Uncapped accounts hitting a non-daily-limit paywall (e.g. Pro media)
  // see the inline upsell — the candle isn't burning out, but a feature
  // requires upgrade in-context.
  if (candle.turnsAllowed === null) {
    if (reason === "daily_limit") return "topbar";
    return "inline";
  }

  const remaining = Math.max(0, candle.turnsAllowed - candle.turnsUsed);

  if (remaining <= 0) return "soft";
  if (remaining <= 1) return "inline";
  return "topbar";
}
