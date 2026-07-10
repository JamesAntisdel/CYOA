import { llmEffectSchema, llmSceneOutputSchema, type LlmSceneProposal } from "@cyoa/engine";
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
 * Extract the FIRST complete top-level JSON object from a string. Walks
 * the input counting `{`/`}` while respecting string boundaries (and
 * escape sequences inside strings). Returns the slice from the first
 * `{` to its matching `}` inclusive; if no opener is found, returns the
 * input unchanged.
 *
 * Why this exists: without grammar-constrained `responseSchema`, Gemini
 * occasionally returns a valid JSON object followed by trailing prose
 * (e.g. "...here's the scene above", a stray closing fence, repeated
 * objects). `JSON.parse` on the raw text then throws
 * `Unexpected non-whitespace character after JSON at position N` even
 * though the JSON itself is valid. This helper picks out the first
 * object so the parser sees clean input. Unclosed input (still inside
 * a string or unbalanced braces at EOF) falls through unchanged so the
 * downstream `JSON.parse` raises its normal error.
 */
function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text;
}

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
  const stripped = stripLlmFencingAndPreamble(raw);
  if (!stripped.startsWith("{")) return { prose: stripped, choiceMetadata: [] };
  // Even after fence-stripping, Gemini sometimes appends trailing text
  // after the closing brace. `extractFirstJsonObject` picks just the
  // first complete object so JSON.parse doesn't fail on trailing junk.
  const trimmed = extractFirstJsonObject(stripped);
  const candidate = JSON.parse(trimmed);
  const llmDriven = llmSceneOutputSchema.safeParse(candidate);
  if (llmDriven.success) {
    return projectFromLlmDrivenProposal(llmDriven.data);
  }
  // Even with `clampedString` transforms on every LLM-emitted string
  // (see packages/engine/src/llm.ts), the Zod schema can still reject
  // for shape-level reasons (missing required field, wrong effect kind,
  // duplicate choice id). Log the first few issues so an operator can
  // see what Gemini drifted on without grepping streams.
  try {
    const issues = llmDriven.error.issues.slice(0, 5).map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));
    console.warn(
      `[parseScene] llm-driven zod rejected; issues=${JSON.stringify(issues)} candidate_keys=${JSON.stringify(Object.keys(candidate ?? {}))}`,
    );
  } catch {
    // best-effort log only
  }
  return authoredSceneSchema.parse(candidate);
}

/**
 * Observability for the schema's tolerant effect handling: `llmChoiceSchema`
 * silently drops individual malformed effects (an unrecognized `kind`, or more
 * than the per-choice cap) instead of failing the whole scene. Log which kinds
 * were dropped so model drift stays visible — if the model keeps proposing a
 * specific effect we don't support, that's the signal to add it. Best-effort;
 * never throws (a broken candidate still hits the real parse below).
 */
function logDroppedLlmEffects(candidate: unknown): void {
  try {
    const choices = (candidate as { choices?: unknown } | null)?.choices;
    if (!Array.isArray(choices)) return;
    const dropped: string[] = [];
    for (const choice of choices) {
      const effects = (choice as { effects?: unknown } | null)?.effects;
      if (!Array.isArray(effects)) continue;
      for (const effect of effects) {
        if (!llmEffectSchema.safeParse(effect).success) {
          dropped.push(String((effect as { kind?: unknown } | null)?.kind ?? "?"));
        }
      }
    }
    if (dropped.length > 0) {
      console.warn(
        `[parseScene] dropped ${dropped.length} invalid llm effect(s); kinds=${JSON.stringify(dropped)}`,
      );
    }
  } catch {
    // best-effort log only
  }
}

/**
 * Strictly parse the LLM-driven structured shape. Used by the llm-driven turn
 * flow where a malformed payload must trigger a retry / safe-end rather than
 * silently degrade to authored mode. Accepts ```json fenced output and common
 * preambles — failure to parse after stripping raises `llm_scene_invalid_shape`
 * so `completeSceneStream` can fail-loud rather than persist an empty scene.
 */
export function parseLlmDrivenScene(raw: string): LlmSceneProposal {
  const stripped = stripLlmFencingAndPreamble(raw);
  if (!stripped.startsWith("{")) throw new Error("llm_scene_invalid_shape");
  const trimmed = extractFirstJsonObject(stripped);
  let candidate: unknown;
  try {
    candidate = JSON.parse(trimmed);
  } catch {
    throw new Error("llm_scene_invalid_shape");
  }
  logDroppedLlmEffects(candidate);
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
