import type { EntitlementRecord } from "../billing/entitlements";

/**
 * Load an account's entitlement narrowed to `{ tier, status }` (or null when it
 * has none). Shared by the tales / coop function modules, which only need the
 * tier + status to gate mature content and premium features.
 */
export async function loadEntitlementLite(
  ctx: { db: any },
  accountId: unknown,
): Promise<Pick<EntitlementRecord, "tier" | "status"> | null> {
  const doc = await ctx.db
    .query("entitlements")
    .withIndex("by_accountId", (q: any) => q.eq("accountId", accountId))
    .first();
  if (!doc) return null;
  return { tier: doc.tier, status: doc.status };
}
