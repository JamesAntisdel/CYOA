import { llmSceneOutputSchema, type LlmSceneProposal } from "@cyoa/engine";
import { z } from "zod";

import type { ParsedScene } from "./types";

const authoredSceneSchema = z.object({
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

/**
 * Best-effort cleanup of common LLM output wrappers. Models routinely return
 * the JSON object wrapped in a ```json fenced block, sometimes preceded by a
 * preamble line like "Here is the scene:". Strip those wrappers so the JSON
 * detection below can see the actual payload. Returns the trimmed payload —
 * if nothing is recognized, returns the input trimmed unchanged.
 */
function stripLlmFencingAndPreamble(raw: string): string {
  let text = raw.trim();
  // Strip a leading preamble line ending with a colon (e.g. "Here is the
  // scene:") when the very next non-whitespace character is a JSON/fence
  // opener. Avoids eating content from legitimate prose payloads.
  const preambleMatch = text.match(/^[^\n{`]{1,200}:\s*\n+/);
  if (preambleMatch) {
    const rest = text.slice(preambleMatch[0].length).trimStart();
    if (rest.startsWith("{") || rest.startsWith("```")) {
      text = rest;
    }
  }
  // Strip surrounding ```json ... ``` (or generic ``` ... ```) fences.
  if (text.startsWith("```")) {
    const fenceClose = text.lastIndexOf("```");
    if (fenceClose > 3) {
      let inner = text.slice(3, fenceClose);
      // Drop an optional language tag on the opening fence line.
      const newlineIdx = inner.indexOf("\n");
      if (newlineIdx >= 0) {
        const firstLine = inner.slice(0, newlineIdx).trim();
        if (/^[A-Za-z0-9_-]{0,16}$/.test(firstLine)) {
          inner = inner.slice(newlineIdx + 1);
        }
      }
      text = inner.trim();
    }
  }
  return text;
}

/**
 * Parse the raw text the LLM produced for one scene. Three shapes are
 * supported, in order of preference:
 *
 *  1. The llm-driven contract: `{ prose, choices, terminal? }`. The engine's
 *     Zod schema validates effects and clamps numeric deltas. We map the
 *     structured choices down to authored-shape `choiceMetadata` so the
 *     existing reader UI doesn't need a parallel render path.
 *  2. The authored hint contract: `{ prose, choiceMetadata }`. Pure prose
 *     layered over an authored node graph.
 *  3. Plain text. The author-mode reader falls back to seed-text choices.
 */
export function parseSceneOutput(raw: string): ParsedScene {
  const trimmed = stripLlmFencingAndPreamble(raw);
  if (!trimmed.startsWith("{")) return { prose: trimmed, choiceMetadata: [] };

  const candidate = JSON.parse(trimmed);
  const llmDriven = llmSceneOutputSchema.safeParse(candidate);
  if (llmDriven.success) {
    return projectFromLlmDrivenProposal(llmDriven.data);
  }
  return authoredSceneSchema.parse(candidate);
}

/**
 * Strictly parse the LLM-driven structured shape. Used by the llm-driven turn
 * flow where a malformed payload must trigger a retry / safe-end rather than
 * silently degrade to authored mode. Accepts ```json fenced output and common
 * preambles — failure to parse after stripping raises `llm_scene_invalid_shape`
 * so `completeSceneStream` can fail-loud rather than persist an empty scene.
 */
export function parseLlmDrivenScene(raw: string): LlmSceneProposal {
  const trimmed = stripLlmFencingAndPreamble(raw);
  if (!trimmed.startsWith("{")) throw new Error("llm_scene_invalid_shape");
  let candidate: unknown;
  try {
    candidate = JSON.parse(trimmed);
  } catch {
    throw new Error("llm_scene_invalid_shape");
  }
  const parsed = llmSceneOutputSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("llm_scene_invalid_shape");
  return parsed.data;
}

function projectFromLlmDrivenProposal(proposal: LlmSceneProposal): ParsedScene {
  return {
    prose: proposal.prose,
    choiceMetadata: proposal.choices.map((choice) => ({
      choiceId: choice.id,
      ...(choice.label === undefined ? {} : { label: choice.label }),
      ...(choice.tone === undefined ? {} : { tone: choice.tone }),
    })),
    proposal,
  };
}

export function assertNoStateMutationFields(raw: unknown): void {
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw);
    const forbidden = ["state", "stats", "inventory", "flags", "currency", "vitality"];
    const found = keys.find((key) => forbidden.includes(key));
    if (found) throw new Error(`llm_state_field_forbidden:${found}`);
  }
}
