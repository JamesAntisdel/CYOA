import { z } from "zod";

export const ageBandSchema = z.enum(["13-17", "18+"]);
export type AgeBand = z.infer<typeof ageBandSchema>;

export const matureCategorySchema = z.enum([
  "adult_language",
  "adult_subject",
  "adult_image",
]);
export type MatureCategory = z.infer<typeof matureCategorySchema>;

export const blockedSafetyCategorySchema = z.enum([
  "self_harm",
  "suicide",
  "depressive_hopelessness",
  "player_directed_despair",
]);
export type BlockedSafetyCategory = z.infer<typeof blockedSafetyCategorySchema>;

export const contentPolicyActionSchema = z.enum([
  "allow",
  "rewrite",
  "safe_redirect",
  "safe_end",
  "block",
]);
export type ContentPolicyAction = z.infer<typeof contentPolicyActionSchema>;

export const contentPolicySummarySchema = z.object({
  action: contentPolicyActionSchema,
  safetyCategories: z.array(blockedSafetyCategorySchema).default([]),
  matureCategories: z.array(matureCategorySchema).default([]),
  redacted: z.boolean(),
});
export type ContentPolicySummary = z.infer<typeof contentPolicySummarySchema>;

export const contentPolicyContextSchema = z.object({
  accountId: z.string().optional(),
  ageBand: ageBandSchema.optional(),
  entitlementTier: z.enum(["free", "unlimited", "pro"]).default("free"),
  matureContentEnabled: z.boolean().default(false),
  surface: z.enum([
    "generation",
    "media",
    "publishing",
    "forking",
    "read_along",
    "discovery",
    "coop",
  ]),
});
export type ContentPolicyContext = z.infer<typeof contentPolicyContextSchema>;

export const safeEndingSceneSchema = z.object({
  status: z.literal("ended_safely"),
  title: z.string().min(1),
  prose: z.string().min(1),
  offeredBecause: z.array(blockedSafetyCategorySchema),
});
export type SafeEndingScene = z.infer<typeof safeEndingSceneSchema>;
