import { z } from "zod";

import { ageBandSchema } from "../content";

export const idSchema = z.string().min(1);

export const choiceViewSchema = z.object({
  choiceId: z.string().min(1),
  label: z.string().min(1),
  visibility: z.enum(["visible", "locked"]),
  lockedHint: z.string().optional(),
});
export type ChoiceView = z.infer<typeof choiceViewSchema>;

export const statViewSchema = z.object({
  statId: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  visible: z.boolean(),
});
export type StatView = z.infer<typeof statViewSchema>;

export const currentSceneResponseSchema = z.object({
  saveId: idSchema,
  sceneId: idSchema.optional(),
  storyId: z.string().min(1),
  nodeId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
  prose: z.string(),
  streamStatus: z.enum(["pending", "streaming", "complete", "failed", "blocked"]),
  choices: z.array(choiceViewSchema),
  stats: z.array(statViewSchema),
});
export type CurrentSceneResponse = z.infer<typeof currentSceneResponseSchema>;

export const submitTurnRequestSchema = z.object({
  saveId: idSchema,
  choiceId: z.string().min(1),
  requestId: z.string().min(8),
});
export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;

export const createSaveRequestSchema = z.object({
  storyId: z.string().min(1),
  mode: z.enum(["story", "hardcore"]).default("story"),
});
export type CreateSaveRequest = z.infer<typeof createSaveRequestSchema>;

export const ageGateRequestSchema = z.object({
  ageBand: ageBandSchema.or(z.literal("under_13")),
});
export type AgeGateRequest = z.infer<typeof ageGateRequestSchema>;

export const coopParticipantProjectionSchema = z.object({
  participantId: z.string().min(1),
  displayName: z.string().min(1),
  avatarInitial: z.string().min(1).max(2),
  role: z.enum(["host", "player", "spectator"]),
  presence: z.enum(["online", "idle", "offline"]),
  hasVoted: z.boolean().optional(),
});
export type CoopParticipantProjection = z.infer<typeof coopParticipantProjectionSchema>;

export const coopRoomProjectionSchema = z.object({
  roomId: idSchema,
  saveId: idSchema,
  status: z.enum(["open", "active", "closed"]),
  mode: z.enum(["pass", "vote"]),
  participants: z.array(coopParticipantProjectionSchema),
  activeParticipantId: z.string().optional(),
  voteEndsAt: z.number().int().nonnegative().optional(),
});
export type CoopRoomProjection = z.infer<typeof coopRoomProjectionSchema>;

export const publishTaleRequestSchema = z.object({
  saveId: idSchema,
  title: z.string().min(1).max(120),
  synopsis: z.string().max(280),
  privacy: z.enum(["public", "unlisted", "friends"]),
  forkPolicy: z.enum(["any_decision", "ending_only", "disabled"]),
});
export type PublishTaleRequest = z.infer<typeof publishTaleRequestSchema>;
