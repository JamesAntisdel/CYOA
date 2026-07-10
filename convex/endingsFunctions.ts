import { queryGeneric } from "convex/server";
import { v } from "convex/values";

import { loadAndAuthorizeAccount } from "./lib/authz";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

export type UnlockedEndingView = {
  storyId: string;
  endingId: string;
  firstSeen: number;
  mode: "story" | "hardcore";
  path: string[];
  safetyEnding: boolean;
};

/**
 * List every ending the account has unlocked (Req 8.6 / 19.1). The endings
 * screen merges these with the story ending-catalog to render the trophy crypt
 * — locked endings stay concealed, unlocked ones surface with their path, and
 * recently-unlocked ones get a "★ NEW" badge (firstSeen).
 */
export const listUnlockedEndings = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args): Promise<UnlockedEndingView[]> => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const rows = await ctx.db
      .query("endings_unlocked")
      .withIndex("by_account_story", (q: any) => q.eq("accountId", args.accountId))
      .collect();
    return rows.map((row: any) => ({
      storyId: String(row.storyId),
      endingId: String(row.endingId),
      firstSeen: typeof row.firstSeen === "number" ? row.firstSeen : 0,
      mode: row.mode === "hardcore" ? "hardcore" : "story",
      path: Array.isArray(row.path) ? row.path.map((p: unknown) => String(p)) : [],
      safetyEnding: row.safetyEnding === true,
    }));
  },
});
