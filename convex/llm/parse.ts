import { z } from "zod";

import type { ParsedScene } from "./types";

const sceneSchema = z.object({
  prose: z.string().min(1),
  choiceMetadata: z
    .array(
      z.object({
        choiceId: z.string().min(1),
        tone: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .default([]),
});

export function parseSceneOutput(raw: string): ParsedScene {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return sceneSchema.parse(JSON.parse(trimmed));
  }
  return { prose: trimmed, choiceMetadata: [] };
}

export function assertNoStateMutationFields(raw: unknown): void {
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw);
    const forbidden = ["state", "stats", "inventory", "flags", "currency", "vitality"];
    const found = keys.find((key) => forbidden.includes(key));
    if (found) throw new Error(`llm_state_field_forbidden:${found}`);
  }
}
