import type { PlayerStateSnapshot, SceneGenerationRequest } from "../types";

/**
 * Build the prompt body for a scene generation request. The shape adapts to
 * the request mode:
 *
 *  - "authored" (default, legacy): the LLM only writes prose for an
 *    already-defined authored node. It must not mutate state.
 *  - "llm-driven": the LLM proposes prose + 2–4 choices + per-choice effects
 *    + an optional terminal marker, as strict JSON. The engine validates and
 *    clamps everything before any of it touches game state.
 */
export function buildScenePrompt(request: SceneGenerationRequest): string {
  if (request.mode === "llm-driven") return buildLlmDrivenPrompt(request);
  return buildAuthoredPrompt(request);
}

function buildAuthoredPrompt(request: SceneGenerationRequest): string {
  const memory = request.memory.length > 0 ? request.memory.join("\n") : "No prior memory.";
  const choices = request.choices.map((choice) => `- ${choice.choiceId}: ${choice.label}`).join("\n");
  return [
    `Story: ${request.storyId}`,
    `Node: ${request.nodeId}`,
    `Seed: ${request.seed}`,
    `Scene length: ${lengthInstruction(request.sceneLength)}`,
    `Memory:\n${memory}`,
    `Available choices:\n${choices}`,
    "Write prose only. Do not mutate state, stats, inventory, flags, vitality, or currency.",
  ].join("\n\n");
}

function buildLlmDrivenPrompt(request: SceneGenerationRequest): string {
  const memory = request.memory.length > 0 ? request.memory.join("\n") : "No prior memory yet.";
  // Mature consent is gated upstream in `matureContextForAccount` — by the time
  // we reach this prompt with `matureContentEnabled: true`, the reader is 18+,
  // has opted in, and holds an unlimited/pro entitlement. The narrator may
  // employ adult language and adult subject matter where it serves the story,
  // but the §9 safety rules below (self-harm, despair-induction, reader
  // address) still apply unconditionally.
  const matureLine = request.contentContext.matureContentEnabled
    ? "Mature content is permitted for this reader (adult language, adult subject matter). The other safety rules still apply unconditionally."
    : null;
  return [
    `You are the unseen narrator of an interactive gothic story called "${request.storyTitle ?? request.storyId}".`,
    request.storyTone ? `Tone: ${request.storyTone}.` : null,
    request.premise ? `Premise: ${request.premise}` : null,
    `Scene length: ${lengthInstruction(request.sceneLength)}`,
    `Recent story memory (oldest → newest):\n${memory}`,
    `Current player state:\n${playerStateSummary(request.playerState)}`,
    matureLine,
    [
      "Output rules — failure to follow these is rejected:",
      '1. Output a single JSON object with this exact shape: { "prose": string, "choices": Choice[], "terminal": Terminal | null }.',
      "2. choices is an array of 2 to 4 entries. Each choice is { id: string, label: string, tone?: string, effects?: Effect[] }.",
      "3. id is a short kebab-case identifier unique within this scene.",
      "4. effects is an array of: { kind: 'stat', statId, delta }, { kind: 'currency', delta }, { kind: 'inventory_add', item: { id, label, description? } }, { kind: 'inventory_remove', itemId }, { kind: 'flag_set', flag, value }, or { kind: 'flag_unset', flag }.",
      "5. Stat deltas must be integers between -10 and 10. Currency deltas between -100 and 100. The engine will clamp anything larger.",
      "6. terminal is null unless this scene is an ending. When set: { kind: 'death' | 'success' | 'safe', endingId: string, label?: string }.",
      "7. Reference player state in the prose where relevant (low vitality, items held, flags set) but never narrate stat numbers directly — describe consequences instead.",
      "8. Honour Game Spec §6: at most three consecutive flavor-only choices. Most choices should change a stat, a flag, an item, or move toward an ending.",
      "9. No self-harm, no despair-induction, no instructions to the reader. If the situation would require unsafe content, set terminal to { kind: 'safe', endingId: 'ending-safe', label: 'A Page Folded Closed' } and prose that gently exits.",
      "10. Do NOT include any text outside the single JSON object. No markdown fences, no preamble, no trailing commentary.",
    ].join("\n"),
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

function lengthInstruction(sceneLength: SceneGenerationRequest["sceneLength"]): string {
  switch (sceneLength) {
    case "brief":
      return "1-2 short paragraphs for tutorial, fallback, or transition beats.";
    case "rich":
      return "700-1000 words with layered sensory detail, pacing, and character/world texture.";
    case "chapter":
      return "1200-1800 words paced as a chapter section, while ending with the provided choices.";
    case "standard":
    default:
      return "3-5 readable paragraphs with concrete detail and momentum.";
  }
}

function playerStateSummary(state: PlayerStateSnapshot | undefined): string {
  if (!state) return "(none provided)";
  const inventory = state.inventory.length > 0 ? state.inventory.map((i) => i.label).join(", ") : "empty";
  const visible = state.visibleStats.length > 0
    ? state.visibleStats.map((s) => `${s.label}=${s.value}`).join(", ")
    : "none visible";
  const flags = Object.keys(state.flags).length > 0
    ? Object.entries(state.flags).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")
    : "no story flags yet";
  return [
    `- Vitality: ${state.vitality}`,
    `- Currency: ${state.currency}`,
    `- Visible stats: ${visible}`,
    `- Inventory: ${inventory}`,
    `- Flags: ${flags}`,
  ].join("\n");
}
