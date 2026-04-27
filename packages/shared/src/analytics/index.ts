import { z } from "zod";

export const analyticsEventNameSchema = z.enum([
  "age_gate.shown",
  "age_gate.blocked",
  "guest.created",
  "save.created",
  "turn.received",
  "engine.applied",
  "llm.requested",
  "llm.first_token",
  "llm.completed",
  "turn.persisted",
  "turn.failed",
  "safety.redirected",
  "safety.ended",
  "safety.blocked",
  "paywall.shown",
  "billing.checkout_started",
  "billing.entitlement_updated",
  "coop.room_created",
  "coop.joined",
  "coop.vote_cast",
  "tale.published",
  "tale.forked",
  "ending.unlocked",
  "admin.dashboard_viewed",
]);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

export const providerNameSchema = z.enum([
  "anthropic",
  "vertex",
  "deepseek",
  "deterministic",
]);
export type ProviderName = z.infer<typeof providerNameSchema>;

export const analyticsEventSchema = z.object({
  accountId: z.string().optional(),
  saveId: z.string().optional(),
  taleId: z.string().optional(),
  roomId: z.string().optional(),
  eventName: analyticsEventNameSchema,
  storyId: z.string().optional(),
  turnNumber: z.number().int().nonnegative().optional(),
  provider: providerNameSchema.optional(),
  payload: z.record(z.unknown()).default({}),
  redacted: z.boolean(),
  createdAt: z.number().int().nonnegative(),
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
