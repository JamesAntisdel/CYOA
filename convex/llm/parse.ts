import {
  llmEffectSchema,
  llmSceneOutputSchema,
  sceneSchemaFor,
  type LlmSceneProposal,
} from "@cyoa/engine";
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
export function parseSceneOutput(
  raw: string,
  readingMode?: "branching" | "novel",
): ParsedScene {
  const stripped = stripLlmFencingAndPreamble(raw);
  if (!stripped.startsWith("{")) return { prose: stripped, choiceMetadata: [] };
  // Even after fence-stripping, Gemini sometimes appends trailing text
  // after the closing brace. `extractFirstJsonObject` picks just the
  // first complete object so JSON.parse doesn't fail on trailing junk.
  const trimmed = extractFirstJsonObject(stripped);
  const candidate = JSON.parse(trimmed);
  // RM3 — the LIVE SSE gate (the fifth parse site). Select the additive novel
  // schema (choices min(0).max(1)) for novel saves so a valid 0/1-choice novel
  // payload is not rejected here (which would fall through to
  // `authoredSceneSchema` → no proposal → `completeSceneStream` throws before it
  // ever sees the payload). Absent/branching ⇒ the byte-identical branching
  // schema (min(2)); the mode is threaded from `LlmRouter.generateScene` via
  // `request.readingMode`.
  const sceneSchema = sceneSchemaFor(readingMode);
  const llmDriven = sceneSchema.safeParse(candidate);
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
 * Observability for the schema's tolerant handling (BC5). `llmChoiceSchema`
 * silently drops individual malformed effects/conditions (an unrecognized
 * `kind`, or more than the per-choice cap) and the scene schema drops a
 * malformed `storyArc` / `beatFired` instead of failing the whole scene. Log
 * what was dropped so model drift stays visible — if the model keeps proposing
 * a specific shape we don't support, that's the signal to add it. Best-effort;
 * never throws (a broken candidate still hits the real parse below).
 */
function logDroppedLlmEffects(candidate: unknown): void {
  try {
    const root = candidate as Record<string, unknown> | null;
    // Whole-scene parse: reveals which top-level fields (storyArc, beatFired)
    // and per-choice fields (conditions) the schema kept vs dropped.
    const sceneParsed = llmSceneOutputSchema.safeParse(candidate);
    const parsedData = sceneParsed.success
      ? (sceneParsed.data as unknown as Record<string, unknown>)
      : null;

    const choices = root?.choices;
    const droppedEffects: string[] = [];
    let droppedConditions = 0;
    const droppedConditionKinds: string[] = [];
    if (Array.isArray(choices)) {
      const parsedChoices = Array.isArray(parsedData?.choices)
        ? (parsedData?.choices as unknown[])
        : [];
      choices.forEach((choice, index) => {
        const effects = (choice as { effects?: unknown } | null)?.effects;
        if (Array.isArray(effects)) {
          for (const effect of effects) {
            if (!llmEffectSchema.safeParse(effect).success) {
              droppedEffects.push(
                String((effect as { kind?: unknown } | null)?.kind ?? "?"),
              );
            }
          }
        }
        // Conditions are dropped per-entry by the choice schema; compare raw
        // count vs the parsed choice's kept count. Only inspect when the model
        // actually emitted a `conditions` array (legacy scenes have none).
        const rawConditions = (choice as { conditions?: unknown } | null)?.conditions;
        if (Array.isArray(rawConditions) && rawConditions.length > 0) {
          const parsedConditions =
            (parsedChoices[index] as { conditions?: unknown } | undefined)?.conditions;
          const keptCount = Array.isArray(parsedConditions) ? parsedConditions.length : 0;
          if (rawConditions.length > keptCount) {
            droppedConditions += rawConditions.length - keptCount;
            for (const c of rawConditions) {
              droppedConditionKinds.push(
                String((c as { kind?: unknown } | null)?.kind ?? "?"),
              );
            }
          }
        }
      });
    }

    // Top-level tolerant-drop signals (only when the model emitted the field).
    const rawHasStoryArc =
      root?.storyArc !== undefined && root?.storyArc !== null;
    const storyArcDropped = rawHasStoryArc && parsedData?.storyArc === undefined;
    const rawBeatFired = root?.beatFired;
    const rawHasBeatFired =
      typeof rawBeatFired === "string" && rawBeatFired.trim().length > 0;
    const beatFiredDropped = rawHasBeatFired && parsedData?.beatFired === undefined;

    if (droppedEffects.length > 0) {
      console.warn(
        `[parseScene] dropped ${droppedEffects.length} invalid llm effect(s); kinds=${JSON.stringify(droppedEffects)}`,
      );
    }
    if (droppedConditions > 0) {
      console.warn(
        `[parseScene] dropped ${droppedConditions} invalid llm condition(s); kinds=${JSON.stringify(droppedConditionKinds)}`,
      );
    }
    if (storyArcDropped) {
      console.warn("[parseScene] dropped malformed storyArc (1); scene survives");
    }
    if (beatFiredDropped) {
      console.warn(
        `[parseScene] dropped invalid beatFired (1); value=${JSON.stringify(String(rawBeatFired).slice(0, 48))}`,
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
