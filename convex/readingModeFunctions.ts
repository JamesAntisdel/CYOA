// reading-modes A1 (SERVER) — the live reading-mode switch mutation.
//
// POSTURE CHANGE (R4, posture A → posture B). At create, `createSaveHandler`
// resolves `readingMode` ONCE via `resolveReadingMode({ desired, isPro })` and
// keeps it for the save's lifetime (posture A). This mutation adds posture B:
// a reader may FLIP the content axis mid-run. Switching TO "novel" is re-gated
// through the SAME `resolveReadingMode` seam (Pro-only); switching to
// "branching" is ALWAYS allowed (an entitled reader can always step down, and
// a lapsed Pro is never stranded on a novel prompt they can no longer render).
//
// WHY THIS IS SAFE MID-RUN — the switch "applies from the next turn onward".
// Generation of the NEXT scene reads the LIVE `save.readingMode` (game.ts:1936),
// so it adopts the new mode. The CURRENT scene the reader is on was AUTHORED
// under the prior mode; its persisted proposal (branching min(2) vs novel max(1)
// choices — disjoint by cardinality) would fail the new mode's schema on
// read-back. `readPersistedProposalWithMode` (game.ts) recovers it by parsing
// under the sibling schema when the live-mode schema rejects, and the projection
// renders the current scene in its AUTHORED mode (`readingModeOverride`). So the
// patch neither strands the next turn nor blanks the current scene — it only
// changes what the NEXT generation produces. (There is NO per-scene readingMode
// stamp; the proposal's own choice cardinality is the mode witness.)
//
// Auto-registers by path as `readingModeFunctions:setReadingMode`. Lives in a
// NEW module (convex/index.ts, game.ts, schema.ts are reserved) — it only reads
// shared helpers (loadAndAuthorizeAccount, loadEntitlementLite, resolveReadingMode).

import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { resolveReadingMode } from "@cyoa/engine";

import { hasPaidEntitlement } from "./billing/entitlements";
import { loadEntitlementLite } from "./lib/entitlement";
import { loadAndAuthorizeAccount } from "./lib/authz";
import { devForceProMedia } from "./media/proMediaGate";

/**
 * Flip a save's reading mode (content axis) mid-run. See the module header for
 * the posture-B rationale and the "applies from next turn" guarantee.
 *
 * Contract (pinned — A2 client + Wave-2 UI depend on these exact shapes):
 *   args:   { saveId, mode: "branching" | "novel", auth?: { accountId, guestTokenHash? } }
 *   return: { ok: true, mode }
 *         | { ok: false, reason: "needs_pro" | "not_found" | "unauthorized" }
 *
 * Soft returns (never throws) for the auth/gate outcomes so the client can
 * render the Pro upsell / a benign no-op without a mutation rejection.
 */
export const setReadingMode = mutationGeneric({
  args: {
    saveId: v.id("saves"),
    mode: v.union(v.literal("branching"), v.literal("novel")),
    auth: v.optional(
      v.object({
        accountId: v.id("accounts"),
        guestTokenHash: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Save must exist before we spend any auth work on it.
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) {
      return { ok: false, reason: "not_found" } as const;
    }

    // Ownership. Absent auth can never prove ownership; present auth is checked
    // exactly as game.ts does (loadAndAuthorizeAccount = account exists + this
    // session owns it, then the save's accountId must match the caller). Both
    // failures collapse to the soft "unauthorized" reason instead of throwing.
    if (!args.auth) {
      return { ok: false, reason: "unauthorized" } as const;
    }
    try {
      await loadAndAuthorizeAccount(ctx, args.auth.accountId, args.auth.guestTokenHash);
    } catch {
      return { ok: false, reason: "unauthorized" } as const;
    }
    if ((saveDoc as { accountId?: unknown }).accountId !== args.auth.accountId) {
      return { ok: false, reason: "unauthorized" } as const;
    }

    // Pro resolution mirrors createSaveHandler (game.ts:495): the real paid
    // entitlement OR the dev/tunnel force-Pro switch, so a dev env can flip to
    // novel without a Stripe subscription. UNSET in prod ⇒ the real gate.
    const entitlementLite = await loadEntitlementLite(ctx, args.auth.accountId);
    const isPro =
      (entitlementLite ? hasPaidEntitlement(entitlementLite) : false) || devForceProMedia();

    // Re-gate through the SAME seam createSave uses. Switching to "novel" while
    // not Pro degrades to "branching" here — which we treat as a hard rejection
    // (needs_pro) and do NOT patch, so a non-Pro flip is a true no-op the client
    // can turn into an upsell. Switching to "branching" always resolves to
    // "branching" and is always allowed.
    const resolved = resolveReadingMode({ desired: args.mode, isPro });
    if (args.mode === "novel" && resolved !== "novel") {
      return { ok: false, reason: "needs_pro" } as const;
    }

    // Persist the resolved mode EXPLICITLY — including "branching" when leaving
    // novel (unlike create, which omits the field). A save that was novel must
    // read back as branching after a step-down, so an absent field would be
    // wrong here; we store the literal.
    await ctx.db.patch(args.saveId, {
      readingMode: resolved,
      updatedAt: Date.now(),
    });
    return { ok: true, mode: resolved } as const;
  },
});
