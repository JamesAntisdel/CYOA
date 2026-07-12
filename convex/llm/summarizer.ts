// Running "story so far" summarizer. Bug fix: the LLM repeated actions
// across long reads (e.g. "open the coconut" on turn 4 after the reader
// opened it on turn 2) because the 6-turn memory window only carried
// scene excerpts + choice labels — there was no canonical record of what
// had already happened. This module maintains a compact, single-paragraph
// summary on `save.storySummary` that the scene-prompt builder surfaces
// above the memory window as authoritative continuity.
//
// Three pieces live in this file:
//
//   1. `buildSummarizerPrompt` (pure helper) — produces the prompt body
//      from the input fields. Pure + exported so the unit test pins the
//      format.
//   2. `summarizeStory` (action) — scheduled non-blocking from
//      `completeSceneStream` after each successful turn. Calls the
//      cheapest configured LLM (DeepSeek if available, then Anthropic /
//      Vertex / Gemini, falling back to a deterministic stub) with a
//      tight prompt and a short token budget. On success, calls
//      `setStorySummary` to patch the save. On any failure (provider
//      down, parse error, timeout) it logs and exits — the prior summary
//      stays in place and the read is NEVER blocked.
//   3. `setStorySummary` (internal mutation) — patches `save.storySummary`
//      + `save.updatedAt`. The action's only mutation; kept narrow so the
//      summarizer surface has a tiny blast radius.

import { v } from "convex/values";
import { actionGeneric, internalMutationGeneric } from "convex/server";

import {
  appendPath,
  postJson,
  readEnv,
  readTimeoutMs,
} from "./httpClient";
import { fireworksModelId, readFireworksConfig } from "./fireworks";

const accountIdValidator = v.id("accounts");
const saveIdValidator = v.id("saves");

// Hard cap. The schema field is optional + uncapped, but every persisted
// summary is trimmed to this length defensively so a misbehaving provider
// can never bloat the save document. Raised 500 → 2000 on 2026-05-28
// because a 500-char summary cannot retain compound durable state across
// 10+ turns (vehicle conditions, location history, NPC dispositions, open
// threads). At 2000 chars the structured block (LOCATION / PROTAGONIST /
// KEY OBJECTS / CHARACTERS / OPEN THREADS / RECENT BEATS) has room to
// carry every fact the next scene needs without dropping the van being
// upside-down or the apartment we already left.
export const STORY_SUMMARY_MAX_CHARS = 2000;

// Scene excerpts longer than this don't help the summarizer — the model
// only needs enough of the latest scene to extract canonical facts. Kept
// short so the prompt stays cheap (target: under 600 tokens total).
export const SUMMARIZER_SCENE_EXCERPT_MAX_CHARS = 400;

// Maximum tokens for the summarizer's reply. The output is a structured
// block (~2000 chars). 900 tokens covers the budget with headroom.
const SUMMARIZER_MAX_OUTPUT_TOKENS = 900;

export type SummarizerInput = {
  premise: string;
  turnNumber: number;
  priorSummary: string;
  lastSceneExcerpt: string;
  lastChoiceLabel: string;
};

/**
 * Build the summarizer prompt from the input fields. Pure so the unit
 * test pins the exact format — the prompt is part of the public contract
 * with the summarization LLM and silent drift would be a regression risk.
 *
 * Trims the scene excerpt to {@link SUMMARIZER_SCENE_EXCERPT_MAX_CHARS}
 * and normalises whitespace so the prompt budget is stable even when the
 * caller passes raw prose with newlines.
 */
export function buildSummarizerPrompt(input: SummarizerInput): string {
  const premise = (input.premise || "").trim() || "(no explicit premise)";
  const priorSummary = (input.priorSummary || "").trim();
  const excerpt = (input.lastSceneExcerpt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUMMARIZER_SCENE_EXCERPT_MAX_CHARS);
  const choice = (input.lastChoiceLabel || "").trim() || "(no explicit choice)";
  return [
    "You maintain a structured running summary of an interactive story so the next scene's writer never forgets durable world state.",
    "",
    `Story premise: ${premise}`,
    `Turn number: ${input.turnNumber}`,
    "",
    "Prior summary (your last output — update it; do NOT start from scratch):",
    priorSummary.length > 0 ? priorSummary : "(none yet — this is the opening; populate every section from the latest scene)",
    "",
    `Latest scene prose excerpt: ${excerpt}`,
    `Reader's choice this turn: ${choice}`,
    "",
    `Produce the UPDATED summary using EXACTLY this 6-label block format (max ${STORY_SUMMARY_MAX_CHARS} characters total). Carry forward every fact from the prior summary that the latest scene did NOT contradict; only overwrite a fact when the new scene supersedes it.`,
    "",
    "LOCATION: <one sentence — protagonist's CURRENT physical location, including key features of the space they're in right now>",
    "PROTAGONIST: <one short sentence — current physical state (injuries, fatigue, exposure), notable items held, immediate mood/intent>",
    "KEY OBJECTS: <semicolon-separated list — for each notable object the story has touched, give its CURRENT state. Format: 'name (state)'. Examples: 'white van (upside-down on Hwy 14, driver door jammed)'; 'flashlight (half-charged)'; 'apartment 412 (left behind 3 turns ago, key still in pocket)'. CRITICAL: if an object's condition changed (broken, opened, consumed, moved), the state field must reflect that change.>",
    "CHARACTERS: <semicolon-separated list — named NPCs the story has introduced. Format: 'name (relation, last seen)'. Examples: 'Mira (rival, last seen walking north on Hwy 14)'; 'Detective Yoo (offstage, expects a midnight call)'.>",
    "OPEN THREADS: <numbered list of unresolved goals or questions, one per line. Examples: '1) Reach the warehouse meet by midnight; 2) Find out who tipped the cops about the meet.'>",
    "RECENT BEATS: <last 3-4 turn outcomes, each one short clause. Format: 't<turn>: <what happened>'. Examples: 't12: climbed out the rear window; t13: walked north along Hwy 14 in the rain.'>",
    "",
    "Output ONLY the labeled block above. No preamble, no JSON, no markdown fences. Each label on its own line.",
  ].join("\n");
}

/**
 * Clean a raw LLM summary reply: strip markdown fences, leading labels,
 * collapse whitespace, hard-cap at {@link STORY_SUMMARY_MAX_CHARS}.
 * Returns an empty string when the input is empty/whitespace so callers
 * can short-circuit the patch.
 */
export function sanitizeStorySummary(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();
  // Strip a fenced code block if the model wrapped the reply.
  text = text.replace(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/m, "$1").trim();
  // Strip common preamble labels ("Summary:" / "Updated summary:" / etc.).
  text = text.replace(/^(updated\s+)?summary\s*:\s*/i, "").trim();
  // PRESERVE newlines — the structured 6-label block (LOCATION /
  // PROTAGONIST / KEY OBJECTS / ...) relies on label-per-line formatting
  // so the next scene's prompt and the human reader can scan it. We still
  // collapse runs of spaces and tabs on each line, and collapse 3+
  // consecutive newlines down to 2 (so the model can't bloat the field
  // with whitespace).
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= STORY_SUMMARY_MAX_CHARS) return text;
  // Hard-cap. Prefer cutting at a sentence boundary inside the budget so
  // we don't leave a half-sentence dangling, but never grow past the cap.
  const truncated = text.slice(0, STORY_SUMMARY_MAX_CHARS);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? "),
  );
  if (lastSentenceEnd >= Math.floor(STORY_SUMMARY_MAX_CHARS * 0.6)) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }
  return truncated.trim();
}

type SummarizerProviderName = "fireworks" | "anthropic" | "vertex" | "deterministic";

type SummarizerProviderResult = {
  provider: SummarizerProviderName;
  text: string;
};

/**
 * Call the cheapest configured LLM with the summarizer prompt. Tries
 * providers in this order:
 *   1. Fireworks cheap model (cost-optimised; the background cheap path per
 *      provider-and-credit design §1.4)
 *   2. Anthropic (a real Haiku id via ANTHROPIC_SUMMARIZER_MODEL — NOT the
 *      shared ANTHROPIC_MODEL, which silently upgrades to Sonnet)
 *   3. Gemini (Vertex)
 *   4. Deterministic stub (used when nothing else is configured AND in
 *      tests). The stub composes a best-effort summary from the prior +
 *      latest excerpt without calling any model.
 *
 * Returns `null` ONLY when every path threw — the caller treats null as
 * "keep prior summary, never block the read".
 */
async function callSummarizer(input: SummarizerInput): Promise<SummarizerProviderResult | null> {
  const prompt = buildSummarizerPrompt(input);

  // 1. Fireworks cheap model — the background cheap path (design §1.4).
  // Configured iff FIREWORKS_API_KEY. Replaces the old direct-DeepSeek leg
  // (whose hardcoded `deepseek-chat` alias is deprecated); Fireworks serves
  // DeepSeek-V3 as its cheap model. The deterministic stub at step 4 still
  // covers true offline-dev runs where no provider is configured at all.
  const fireworks = readFireworksConfig();
  if (fireworks.apiKey) {
    try {
      const response = await postJson({
        url: appendPath(fireworks.baseUrl, "/chat/completions"),
        timeoutMs: fireworks.timeoutMs,
        headers: { authorization: `Bearer ${fireworks.apiKey}` },
        body: {
          model: fireworksModelId("cheap"),
          temperature: 0.3,
          max_tokens: SUMMARIZER_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "system",
              content:
                "You write concise running summaries of interactive stories. One paragraph, factual, no preamble.",
            },
            { role: "user", content: prompt },
          ],
        },
      });
      const text = extractOpenAiChatText(response);
      if (text.trim().length > 0) {
        return { provider: "fireworks", text };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[summarizer] fireworks failed: ${message.slice(0, 240)}`);
    }
  }

  // 2. Anthropic — a REAL Haiku id via ANTHROPIC_SUMMARIZER_MODEL. Read a
  // dedicated env, NOT the shared ANTHROPIC_MODEL (which silently upgrades the
  // cheap background call to Sonnet when the scene model is set). Default to
  // the real `claude-haiku-4-5` (the old `claude-haiku-4-6` default did not
  // exist and silently upgraded to Sonnet).
  const anthropicKey = readEnv("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    try {
      const baseUrl = readEnv("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com";
      const response = await postJson({
        url: appendPath(baseUrl, "/v1/messages"),
        timeoutMs: readTimeoutMs(),
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": anthropicKey,
        },
        body: {
          model: readEnv("ANTHROPIC_SUMMARIZER_MODEL") ?? "claude-haiku-4-5",
          max_tokens: SUMMARIZER_MAX_OUTPUT_TOKENS,
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
        },
      });
      const text = extractAnthropicText(response);
      if (text.trim().length > 0) {
        return { provider: "anthropic", text };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[summarizer] anthropic failed: ${message.slice(0, 240)}`);
    }
  }

  // 3. Gemini (Vertex). Use the Generative Language API when GEMINI_API_KEY
  // is set — that's the same lightweight path the vertex.ts provider uses
  // for the scene model.
  const geminiKey = readEnv("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      const model = readEnv("GEMINI_TEXT_MODEL") ?? "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const response = await postJson({
        url,
        timeoutMs: readTimeoutMs(),
        headers: {},
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: SUMMARIZER_MAX_OUTPUT_TOKENS,
            // CRITICAL: without this, Gemini 3 Flash spends the entire
            // maxOutputTokens budget on hidden reasoning and returns only
            // ~150 chars of actual text. We observed structured summary
            // blocks getting truncated mid-label (e.g. cutting off after
            // "PROTAGONIST:") because the model burned ~750 tokens on
            // reasoning before emitting any text. Same fix as vertex.ts
            // for the scene path.
            thinkingConfig: { thinkingLevel: "minimal" },
          },
        },
      });
      const text = extractGeminiText(response);
      if (text.trim().length > 0) {
        return { provider: "vertex", text };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[summarizer] gemini failed: ${message.slice(0, 240)}`);
    }
  }

  // 4. Deterministic fallback — used in tests and when no provider is
  // configured. Composes a passable summary from prior + excerpt so the
  // continuity context never goes dark.
  try {
    return { provider: "deterministic", text: deterministicSummary(input) };
  } catch {
    return null;
  }
}

// OpenAI-compatible chat completion shape (Fireworks uses it, same as the old
// DeepSeek leg).
function extractOpenAiChatText(response: unknown): string {
  const choice = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
  return choice?.message?.content ?? "";
}

function extractAnthropicText(response: unknown): string {
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  const block = content.find((b) => b?.type === "text" && typeof b.text === "string");
  return (block?.text ?? "").toString();
}

function extractGeminiText(response: unknown): string {
  const candidate = (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
}

/**
 * Compose a deterministic summary without any LLM call. Used when no
 * provider is configured (local dev without keys, unit tests). Produces
 * something coherent enough that the next scene's prompt still gets
 * non-empty continuity signal — far better than the empty-string default
 * the original bug surface had.
 */
function deterministicSummary(input: SummarizerInput): string {
  const prior = (input.priorSummary || "").trim();
  const excerpt = (input.lastSceneExcerpt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const choice = (input.lastChoiceLabel || "").trim();
  const pieces: string[] = [];
  if (prior.length > 0) pieces.push(prior);
  if (excerpt.length > 0) pieces.push(`Turn ${input.turnNumber}: ${excerpt}`);
  if (choice.length > 0) pieces.push(`Reader chose: ${choice}.`);
  return pieces.join(" ");
}

export const summarizeStory = actionGeneric({
  args: {
    saveId: saveIdValidator,
    accountId: accountIdValidator,
    priorSummary: v.string(),
    lastSceneExcerpt: v.string(),
    lastChoiceLabel: v.string(),
    premise: v.string(),
    turnNumber: v.number(),
  },
  handler: async (ctx, args) => {
    // Failure-safe: catch every error path. The summarizer must NEVER
    // surface as a failed read — at worst the prior summary stays in
    // place for one more turn.
    try {
      const result = await callSummarizer({
        premise: args.premise,
        turnNumber: args.turnNumber,
        priorSummary: args.priorSummary,
        lastSceneExcerpt: args.lastSceneExcerpt,
        lastChoiceLabel: args.lastChoiceLabel,
      });
      if (!result) {
        console.warn(`[summarizer] no provider produced output save=${args.saveId} turn=${args.turnNumber}`);
        return { updated: false, reason: "no_provider" } as const;
      }
      const sanitized = sanitizeStorySummary(result.text);
      if (sanitized.length === 0) {
        console.warn(
          `[summarizer] empty output after sanitize save=${args.saveId} turn=${args.turnNumber} provider=${result.provider}`,
        );
        return { updated: false, reason: "empty_output" } as const;
      }
      await ctx.runMutation(
        ("llm/summarizer:setStorySummary" as unknown) as any,
        { saveId: args.saveId, summary: sanitized, at: Date.now() },
      );
      console.log(
        `[summarizer] updated save=${args.saveId} turn=${args.turnNumber} provider=${result.provider} chars=${sanitized.length}`,
      );
      return { updated: true, chars: sanitized.length, provider: result.provider } as const;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[summarizer] unexpected failure save=${args.saveId} turn=${args.turnNumber} error=${message.slice(0, 240)}`,
      );
      return { updated: false, reason: "exception" } as const;
    }
  },
});

export const setStorySummary = internalMutationGeneric({
  args: {
    saveId: saveIdValidator,
    summary: v.string(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const save = await ctx.db.get(args.saveId);
    if (!save) return;
    await ctx.db.patch(args.saveId, {
      storySummary: args.summary,
      updatedAt: args.at,
    });
  },
});
