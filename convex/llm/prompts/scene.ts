import type { NpcState } from "@cyoa/engine";

import type {
  CheckOutcomePromptContext,
  PlayerStateSnapshot,
  PursuitPromptContext,
  SceneGenerationRequest,
} from "../types";

/**
 * Compact sheet projected onto the LLM scene prompt for a single NPC. Hidden
 * attributes and flags are intentionally stripped — the prompt surface is
 * presentational only (Requirement 31.3) and must not leak hidden state.
 */
export type NpcSheet = {
  name: string;
  role: string;
  vibe: string;
  knownFacts: string[];
  attributes: Array<{ label: string; value: number }>;
};

const NPC_SHEET_DEFAULT_CAP = 5;
const NPC_SHEET_MAX_KNOWN_FACTS = 3;

/**
 * Map a clamped disposition scalar (-100..100) to a one-word vibe the prompt
 * narrates instead of the raw number. Mirrors the design.md NPC table:
 *  - >= 50 → friendly
 *  - >= 10 → warm
 *  - >= -10 → neutral
 *  - >= -50 → wary
 *  - <  -50 → hostile
 */
export function mapDispositionToVibe(disposition: number): string {
  if (disposition >= 50) return "friendly";
  if (disposition >= 10) return "warm";
  if (disposition >= -10) return "neutral";
  if (disposition >= -50) return "wary";
  return "hostile";
}

/**
 * Produce a compact NPC sheet for the scene prompt. Sorted by priority:
 *  1. NPCs whose `location` matches `currentNodeId` (currently in-scene).
 *  2. NPCs referenced in the last N turns (`recentMentions`, most-recent first).
 * Ties prefer the location-match cohort. Within `recentMentions` the input
 * order is preserved so the engine's recency-first projection wins. The top
 * `cap` (default 5) sheets are returned per Requirement 31.3 — a chatty cast
 * would otherwise bloat every prompt's token count.
 *
 * Hidden attributes and flags are filtered out so the prompt surface never
 * leaks hidden state (matches the `playerStateSummary` treatment).
 */
export function buildNpcSheets(input: {
  npcs: Record<string, NpcState>;
  currentNodeId: string | null;
  recentMentions: string[];
  cap?: number;
}): NpcSheet[] {
  const cap = Math.max(0, input.cap ?? NPC_SHEET_DEFAULT_CAP);
  if (cap === 0) return [];

  const ordered: NpcState[] = [];
  const seen = new Set<string>();

  // Pass 1: NPCs located in the current scene. Object-iteration order is
  // insertion order, which matches `npc_spawn` recency in practice; that's a
  // stable enough secondary key for v0.
  if (input.currentNodeId !== null) {
    for (const npc of Object.values(input.npcs)) {
      if (npc.location === input.currentNodeId && !seen.has(npc.id)) {
        ordered.push(npc);
        seen.add(npc.id);
      }
    }
  }

  // Pass 2: recent-mention NPCs, preserving the caller's recency-first order.
  for (const id of input.recentMentions) {
    if (seen.has(id)) continue;
    const npc = input.npcs[id];
    if (!npc) continue;
    ordered.push(npc);
    seen.add(npc.id);
  }

  return ordered.slice(0, cap).map(projectNpcSheet);
}

function projectNpcSheet(npc: NpcState): NpcSheet {
  const visibleAttributes = Object.values(npc.attributes)
    .filter((attribute) => attribute.visibility === "visible")
    .map((attribute) => ({ label: attribute.label, value: attribute.value }));
  return {
    name: npc.name,
    role: npc.role,
    vibe: mapDispositionToVibe(npc.disposition),
    knownFacts: npc.knownFacts.slice(0, NPC_SHEET_MAX_KNOWN_FACTS),
    attributes: visibleAttributes,
  };
}

/**
 * Render the "Characters in scope" block for the prompt, or `null` when no
 * sheets are in scope so the prompt skips the section entirely (Req 31.3 —
 * keeps the prompt tight; no "no characters" placeholder line).
 */
function npcSheetsBlock(
  sheets: ReadonlyArray<NpcSheet> | undefined,
): string | null {
  if (!sheets || sheets.length === 0) return null;
  return formatNpcSheetsSection([...sheets]);
}

function formatNpcSheetsSection(sheets: NpcSheet[]): string {
  const header = `Characters in scope (${NPC_SHEET_DEFAULT_CAP} max, most relevant first):`;
  const lines = sheets.map((sheet) => {
    const factsLine = sheet.knownFacts.length > 0
      ? `  Knows: ${sheet.knownFacts.join(", ")}`
      : null;
    const attrsLine = sheet.attributes.length > 0
      ? `  ${sheet.attributes.map((a) => `${a.label} ${a.value}`).join(", ")}`
      : null;
    return [`- ${sheet.name} (${sheet.role}, ${sheet.vibe})`, factsLine, attrsLine]
      .filter((line): line is string => line !== null)
      .join("\n");
  });
  return [header, ...lines].join("\n");
}

/**
 * Render the `== YOUR PURSUIT ==` section (Requirements R1.3 / R6.1). Placed
 * ABOVE the memory window so the spine (dramatic question, target beat,
 * threads, one-shot directives) outranks scene-to-scene variety. Returns null
 * when no pursuit context is present (legacy arc-less saves) so the prompt
 * skips the section entirely.
 *
 * Spoiler discipline (BC10): the single steer-toward beat label appears ONLY
 * on the STEER line; candidate-ending labels are NOT emitted here (they live
 * in the ENDINGS output rule). Neither reaches the reader — the projection
 * strips them.
 */
export function buildPursuitSection(pursuit: PursuitPromptContext): string {
  const fired =
    pursuit.firedBeatLabels.length > 0
      ? pursuit.firedBeatLabels.join(", ")
      : "none";
  const lines: string[] = [
    "== YOUR PURSUIT (the spine — this outranks variety) ==",
    `Dramatic question: ${pursuit.dramaticQuestion}`,
    `The protagonist wants: ${pursuit.protagonistWant}   Stakes if they fail: ${pursuit.stakes}`,
    `Act ${pursuit.act}. Beats already landed: ${fired}.`,
  ];
  if (pursuit.targetBeatLabel) {
    lines.push(
      `STEER TOWARD (subtly, within 1-2 scenes): "${pursuit.targetBeatLabel}".`,
    );
    if (pursuit.targetBeatId) {
      lines.push(
        `When THIS scene lands that beat, set "beatFired": "${pursuit.targetBeatId}".`,
      );
    }
  }
  if (pursuit.directive === "surface_beat" && pursuit.surfaceBeatLabel) {
    lines.push(
      `The story tried to end too early — this scene must put "${pursuit.surfaceBeatLabel}" on stage.`,
    );
  }
  if (pursuit.directive === "narrate_costly_survival") {
    lines.push(
      "The reader survives, barely — narrate a costly escape; do NOT set terminal this scene.",
    );
  }
  // W2 clock escalation (R9.3). Rendered inside the pursuit spine so the doom
  // clock outranks scene variety. `none` prints nothing (early clock).
  if (pursuit.clock) {
    const { label, value, max, directive } = pursuit.clock;
    if (directive === "escalate_50") {
      lines.push(
        `${label} is at ${value}/${max} — the world is closing in. Show it: the antagonist or the environment presses harder this scene.`,
      );
    } else if (directive === "escalate_75") {
      lines.push(
        `${label} is at ${value}/${max} — time is nearly gone. The pressure is acute; raise the stakes and narrow the reader's options this scene.`,
      );
    } else if (directive === "climax_now") {
      lines.push(
        `${label} has run out (${value}/${max}). Move DIRECTLY into the climax under degraded circumstances — no dawdling, no new side-threads. The reader is out of time.`,
      );
    }
  }
  for (const note of pursuit.threadFires) {
    lines.push(`A THREAD FIRES THIS SCENE: "${note}" — narrate the callback.`);
  }
  return lines.join("\n");
}

/**
 * Render the CHECK OUTCOME block (R7.2, W2). The engine already resolved the
 * skill check the reader's chosen choice carried — the model must NARRATE the
 * outcome it was handed, never re-roll or undo it. Placed ABOVE the memory
 * window (canonical result before texture). Returns null when no check fired.
 */
export function buildCheckOutcomeSection(check: CheckOutcomePromptContext): string {
  const word =
    check.outcome === "success"
      ? "SUCCEEDED"
      : check.outcome === "partial"
        ? "PARTLY SUCCEEDED"
        : "FAILED";
  const closeness =
    Math.abs(check.margin) <= 1 ? "barely" : Math.abs(check.margin) >= 4 ? "decisively" : "clearly";
  const lines: string[] = [
    "== CHECK OUTCOME (already resolved by the engine — narrate it, do NOT overrule it) ==",
    `The reader's attempt ${word} (${check.statId}, ${closeness}). Narrate this result as fact this scene; do not undo it, soften it into a re-try, or let the prose contradict it.`,
  ];
  if (check.note && check.note.trim().length > 0) {
    lines.push(`Flavor to weave in: "${check.note.trim()}".`);
  }
  if (check.outcome === "fail") {
    lines.push("A failed attempt has a cost the reader feels — show the consequence, then let the story move on.");
  }
  return lines.join("\n");
}

/**
 * Turn-1 STORY ARC production block (R1.1). Instructs the model to emit a
 * `storyArc` object alongside the scene so the engine can persist the spine.
 * The schema mirrors `validateProposedArc`'s clamps — the engine drops/repairs
 * anything malformed (BC5), so this is guidance, never a hard gate.
 */
const STORY_ARC_PRODUCTION_BLOCK = [
  "STORY ARC (REQUIRED on turn 1 ONLY — ignored on every later turn). Also emit a top-level `storyArc` object that defines what this whole story is FOR:",
  '`storyArc` = { "dramaticQuestion": string (8-160, phrased as a question or charge the reader is playing to answer), "protagonistWant": string (8-120, the concrete thing they pursue), "stakes": string (8-160, what is lost on failure), "beats": Beat[] (3-5), "candidateEndings": Ending[] (2-4) }.',
  '`Beat` = { "id": kebab-slug (≤48), "label": string (≤80, a dramatic milestone), "kind": "inciting" | "midpoint" | "dark_night" | "climax" | "custom", "priorityHint": "early" | "mid" | "late", "requiredBeforeEnding": boolean }. At least the `climax` beat MUST be requiredBeforeEnding: true.',
  '`Ending` = { "id": kebab-slug (≤48), "label": string (≤80), "hint": string (≤120, a spoiler-free teaser) }. These are the possible destinations; the reader must not be told them until reached.',
  "The arc is the reader's promise — make the dramatic question specific to THIS premise, not a generic 'will they survive?'.",
].join("\n");

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
  const storyTitle = request.storyTitle ?? request.storyId;
  // Opener is genre-neutral. Tone is appended only when present — for
  // open-premise launches the reader's authored premise (below) does the
  // setting work; this used to hardcode "gothic story" and pulled every
  // run into cathedrals/candles even for sci-fi or modern premises.
  const opener = `You are the unseen narrator of an interactive story called "${storyTitle}".${request.storyTone ? ` Tone: ${request.storyTone}.` : ""}`;
  // Reader-authored premise wins over every other influence on world choice.
  // Placed near the top so the LLM weights it heavily; the explicit prohibition
  // on medieval/gothic motifs in non-fantasy premises stops the drift the PM
  // scrub flagged (sci-fi premise → cathedrals + lanterns after 2 turns).
  const worldAnchor = request.premise
    ? [
        "WORLD ANCHOR (background context for YOU, the writer — DO NOT copy any of the premise text below into your prose. The reader has already read the premise; your prose must be ENTIRELY NEW content set in the world the premise describes):",
        "",
        "Reader-authored premise:",
        `"""${request.premise}"""`,
        "",
        "Rules for using the WORLD ANCHOR:",
        "1. NEVER quote, paraphrase, or echo the premise text in your `prose` field. The premise is for your eyes only.",
        "2. The premise is the WORLD. Set every scene inside this world.",
        "3. Do not introduce settings, eras, motifs, or characters that contradict the premise. If the premise implies a sci-fi setting, do not introduce candles, cathedrals, lanterns, or other medieval/gothic imagery. If the premise implies modern day, do not introduce fantasy elements.",
        "4. Your `prose` field describes what happens RIGHT NOW in this scene — not a recap of the premise, not the protagonist remembering the premise, not the narrator explaining the premise.",
      ].join("\n")
    : null;
  // Turn band drives the pacing rule below. Without an explicit signal the
  // LLM defaults to "establish the world" mode every turn — producing the
  // repetitive "here is the same sensory opener again" the user reported.
  // Past turn 5 we rotate a dramatic-register beat type so consecutive
  // turns hit different shapes (complication / revelation / confrontation
  // / momentum-shift) instead of collapsing onto a single accelerate band.
  const turnNumber = request.turnNumber ?? request.memory.length + 1;
  const ACCELERATE_BEAT_CYCLE = [
    "complication",
    "revelation",
    "confrontation",
    "momentum-shift",
  ] as const;
  const turnBand = turnNumber <= 2 ? "establish" : turnNumber <= 5 ? "develop" : "accelerate";
  const accelerateBeat =
    turnBand === "accelerate"
      ? ACCELERATE_BEAT_CYCLE[(turnNumber - 6) % ACCELERATE_BEAT_CYCLE.length]
      : null;
  const turnContext = accelerateBeat
    ? `This is turn ${turnNumber} of the story (band: ${turnBand}, beat: ${accelerateBeat}).`
    : `This is turn ${turnNumber} of the story (band: ${turnBand}).`;
  // Running "story so far" summary (Bug fix: LLM repeated actions like
  // "open the coconut" on a beach story because the 6-turn memory window
  // only carries scene excerpts + choice labels, not a canonical record of
  // what's happened). Surface ABOVE the memory window so the LLM treats
  // it as authoritative continuity. Absent on the opening turn.
  const storySummaryBlock = request.storySummary
    ? `Story so far (running summary; treat as canonical):\n${request.storySummary}`
    : null;
  // Story-arc pursuit section (R1.3 / R6.1). Rendered ABOVE the memory window
  // so the spine outranks scene variety. Absent on legacy arc-less saves.
  const pursuitBlock = request.pursuit ? buildPursuitSection(request.pursuit) : null;
  // W2: the resolved skill-check outcome for the choice the reader just picked
  // (R7.2). Rendered ABOVE the memory window so the narrated result is
  // canonical. Absent unless the prior choice carried a check.
  const checkOutcomeBlock = request.checkOutcome
    ? buildCheckOutcomeSection(request.checkOutcome)
    : null;
  const hasArc = request.pursuit !== undefined;
  const candidateEndings = request.pursuit?.candidateEndings ?? [];
  const hasNpcSheets = Array.isArray(request.npcSheets) && request.npcSheets.length > 0;
  // Build the output rule bodies dynamically so the numbering stays consecutive
  // when rule 13 (NPC MENTIONS — which references the "Characters in scope"
  // section) is dropped because no NPC sheets are in scope. Keeping the
  // "Characters in scope" phrase out of the prompt prevents the LLM from
  // hallucinating that section.
  const ruleBodies: string[] = [
    'Output a single JSON object with this exact shape: { "prose": string, "choices": Choice[], "terminal": Terminal | null, "visualDescription"?: string, "npcMentions"?: string[] }.',
    "choices is an array of 2 to 4 entries. Each choice is { id: string, label: string, tone?: string, effects?: Effect[], conditions?: Condition[], lockedHint?: string }.",
    "id is a short kebab-case identifier unique within this scene.",
    "effects is an array of: { kind: 'stat', statId, delta }, { kind: 'currency', delta }, { kind: 'inventory_add', item: { id, label, description? } }, { kind: 'inventory_remove', itemId }, { kind: 'flag_set', flag, value }, { kind: 'flag_unset', flag }, or { kind: 'delayed', delayNodes: 1-12, note: string (the foreshadow line the reader will feel pay off later), effects: Effect[] (1-3 leaf effects that fire when the thread lands) }.",
    "INVENTORY_ADD LOCATION RULE — when you emit `inventory_add`, the item's `description` MUST encode WHERE the item is right now and any notable state. Examples: 'Powerball ticket — hidden between pages 207-208 of The Count of Monte Cristo on the bedroom nightstand'; 'iron key — clipped to your belt loop, sticky with engine grease'; 'compact mirror — in your jacket's inner pocket, shattered on one corner'. The NEXT turn's prompt renders this description in the Current Player State block, and your NEXT scene's prose MUST respect the stated location. Do not narrate the protagonist pulling an item from their hand when its description says it's in a closet. When the protagonist physically moves an item to a new location (pulls the ticket out of the book and into a pocket, drops the key in a drawer), emit `inventory_remove` followed by a fresh `inventory_add` with the updated description on the same choice's effects array.",
    "Stat deltas must be integers between -10 and 10. Currency deltas between -100 and 100. The engine will clamp anything larger.",
    "terminal is null unless this scene is an ending. When set: { kind: 'death' | 'success' | 'safe', endingId: string, label?: string }.",
    "STAT CHANGES MUST BE NARRATED. When this scene's chosen effect changes vitality, currency, a visible stat, or inventory, the prose MUST include a concrete cause-sentence the reader can connect to the change (e.g. 'the climb scraped your knee' for a vitality drop; 'the warm meal steadied you' for a vitality gain; 'you slipped the ledger into your coat' for an inventory_add). Never narrate the stat NUMBER itself — describe the CAUSE in sensory or causal language. Silent stat changes without a narrated cause break reader trust. You may still reference player state in passing (low vitality, items held, flags set) — but every effect this scene produces must have its cause visible in the prose.",
    "DURABLE WORLD STATE — when this scene establishes a fact that will persist for the rest of the read (a vehicle damaged/disabled, a location exited, a door locked, an NPC injured/killed, a deadline set, an item broken, a path closed), emit a `flag_set` effect on the chosen choice with a kebab-case key and a short descriptive STRING value (≤120 chars). Examples: `{ kind: 'flag_set', flag: 'van-state', value: 'upside-down on Hwy 14, driver door jammed' }`; `{ kind: 'flag_set', flag: 'left-location', value: 'apartment 412, key still in pocket' }`; `{ kind: 'flag_set', flag: 'survivor-bearded', value: 'wary, armed with shotgun, behind gas pumps' }`. The next turn's prompt surfaces all flags verbatim in the Current Player State block, so this is how you keep the story from forgetting that the van is upside-down or that you already left the apartment.",
    "CHOICE DIVERGENCE — your 2-4 choices must branch the narrative in DISTINCTLY DIFFERENT directions, not three angles on the same outcome. Each choice should plausibly lead the next scene into a different setting, NPC interaction, tone, or stakes-vector. FORBIDDEN pattern: 'do X cautiously / do X boldly / do X sneakily' triplets — three variants of the same beat. ENCOURAGED pattern: one choice that closes a loop or accepts a cost; one choice that opens a new thread or introduces a complication; one choice that risks an escalation or reveals new information. Honour Game Spec §6: at most three consecutive flavor-only choices; most choices should change a stat, flag, item, or move toward an ending.",
    "No self-harm, no despair-induction, no instructions to the reader. If the situation would require unsafe content, set terminal to { kind: 'safe', endingId: 'ending-safe', label: 'A Page Folded Closed' } and prose that gently exits.",
    "Do not set the `terminal` field before turn 6 unless the reader's choice explicitly forces a death (e.g. \"leap from the cliff\", \"drink the poison\"). For early turns, prefer surfacing new threads, characters, or complications over closing the story.",
    "ANTI-REPETITION (CRITICAL — failure to follow this is the #1 reason scenes feel 'the same every turn'): scan the recent memory beats above. Inventory in your head the openers, settings, NPC entrances, and KEY OBJECTS used in the last 3 scenes — you must not reuse any of them. A reused opener motif (the smell of saltwater again, the same slumped captain, another cracked windshield) is a rejection-worthy failure. Do not re-introduce characters by full name when they were just named (use 'she' / a role / a body-language tag instead). Do not re-describe the same key object the reader has already seen unless its STATE has changed (and then narrate the change). Each scene must feel like the NEXT page of a novel, not a fresh chapter opener.",
    "PACING (band-aware — read the `turn band` and (if present) `beat` from the turn context line above): " +
      "ESTABLISH band (turns 1-2): open with sensory texture — sight, sound, smell, weight, the protagonist's voice and immediate physical state. Build the world. " +
      "DEVELOP band (turns 3-5): the world is already established — DO NOT re-describe the same opening sensory tableau. Pick up the action where the prior scene left off. Advance the character's situation: a new arrival, a new complication, a revealed object, a deeper relationship beat. Keep scene openings TIGHT — one short paragraph of grounding at most, then move. " +
      "ACCELERATE band (turn 6+) — each turn carries a `beat` label that controls its dramatic register; the beat ROTATES so consecutive turns hit different shapes: " +
      "  • beat: complication — a new obstacle the protagonist did not see coming. Something gets harder, a plan breaks, a resource fails. " +
      "  • beat: revelation — a piece of information that recontextualises a prior scene. A character motive shifts, a hidden fact surfaces, the reader sees the situation differently. " +
      "  • beat: confrontation — a direct face-off, dialogue heavy, decision pressure. An NPC pushes back, demands a commitment, escalates an existing thread. " +
      "  • beat: momentum-shift — a hard pivot in pace, location, or stakes. The story breaks open: a chase begins, a door closes, a deadline lands. " +
      "Brisk, consequence-driven. Lead with the action or the dialogue. Two short establishment lines maximum. The beat is a TARGET, not a straitjacket — adjacent beats can blend, but never deliver two consecutive turns of the same beat shape.",
    "VISUAL DESCRIPTION (REQUIRED — the image renderer relies on this field; missing it produces a wrong image). Provide a `visualDescription` field with one concise sentence (under 320 chars) optimized for image generation. Name the SUBJECT (who/what is in frame RIGHT NOW in this scene — not a memory, not a past location), the SETTING (where the scene physically takes place AT THIS MOMENT, time of day, weather/light), 1-3 KEY OBJECTS with their SPATIAL RELATION (\"the cracked windshield to her left\", \"the radio above the seat\"), and the COMPOSITION (close-up, wide shot, over-the-shoulder, etc.). Use concrete real-world referents (\"Boeing 737 cockpit\", \"stainless steel coffee thermos\", \"vinyl bench seat\") not vague nouns (\"airplane\", \"cup\", \"chair\"). Avoid impossible or self-contradictory imagery (no airplanes without noses, no glass that is also wood, no characters described as both tall and seated-with-eye-level-at-ankles). The visualDescription MUST match the CURRENT physical scene in the prose — not a flashback, not a memory, not what the character is thinking about. If the prose opens with a memory or flashback, the visualDescription describes where the character is RIGHT NOW (the cockpit, the conference room, the porch), not the remembered location (their childhood living room, etc.). Example: prose mentions \"she remembers her living room before the flight\" but the scene is set in a 737 cockpit → visualDescription is about the cockpit, NOT the living room.",
  ];
  // Story-arc rules (R6.2, R3.3, R4 guidance, R2.5). Only emitted on arc
  // saves — legacy saves keep the exact prior rule set (BC9). CHOICE
  // CONSEQUENCE tightens the divergence rule's tail; GATED CHOICE + THREADS +
  // ENDINGS wire the new mechanics.
  if (hasArc) {
    ruleBodies.push(
      "CHOICE CONSEQUENCE (this outranks flavor) — every choice you offer should visibly ADVANCE THE PURSUIT, SPEND OR RISK A RESOURCE, or CHANGE A RELATIONSHIP. Label concrete costs in the choice text itself, e.g. \"Bribe the ferryman (-15 gold)\" or \"Break the seal (risk your Nerve)\". A choice with no mechanical or arc consequence is a defect.",
      "GATED CHOICE — roughly every 2-4 scenes, include EXACTLY ONE choice the reader cannot take yet, gated on state they have or nearly have. Attach `conditions` (0-2 of: { kind: 'stat_at_least'|'stat_at_most', statId, value }, { kind: 'has_item'|'missing_item', itemId }, { kind: 'flag_equals', flag, value }, { kind: 'currency_at_least', value }) and a `lockedHint` (≤90 chars, e.g. \"Needs the Bone Key\") so the reader sees the locked door and wants it. At most ONE gated choice per scene, and never gate so hard that fewer than 2 choices remain takeable.",
      "ITEM-ID CONSISTENCY (critical — a mismatch locks a door forever) — when you gate a choice on `has_item`/`missing_item`, the `itemId` MUST be the SAME id you used in the `inventory_add` that grants the item. Reuse the exact kebab-case id (e.g. grant `{ kind: 'inventory_add', item: { id: 'bone-key', label: 'Bone Key' } }`, then gate with `{ kind: 'has_item', itemId: 'bone-key' }`). Do not invent a new spelling ('bonekey', 'the_bone_key', 'Bone Key') for the same object — the reader will hold the key and still be locked out. The Current Player State block lists every held item's id; copy the id from there.",
      "THREADS (foreshadowing that pays off) — use the `delayed` effect to plant a seed now that fires later: at most ONE `delayed` per scene, and its `note` is the foreshadow line the reader should feel when it lands. When a thread fires (surfaced in YOUR PURSUIT as \"A THREAD FIRES THIS SCENE\"), you MUST narrate the callback this scene.",
    );
    if (candidateEndings.length > 0) {
      const list = candidateEndings.map((e) => `${e.id} (${e.label})`).join("; ");
      ruleBodies.push(
        `ENDINGS — when this scene is the ending, choose \`terminal.endingId\` from these CANDIDATE ENDINGS: ${list}. The final scene's prose MUST explicitly answer the dramatic question. Do not name these candidates in the prose before they are reached.`,
      );
    }
    // W2 rules (R7.4-adjacent, R8.5, R9.3, R10, R11.3). Only on arc saves.
    ruleBodies.push(
      "RELATIONSHIPS (R8.5) — the people in \"Characters in scope\" have feelings that shift with the reader's actions. When one shifts, emit `npc_disposition_delta { npcId, delta }` (±15/turn) AND narrate it (a colder tone, a hand withdrawn). When an NPC learns something durable, emit `npc_learn_fact { npcId, fact }` (reader sees \"<name> will remember that\"). At least one choice every 2-3 scenes should meaningfully involve an NPC. Use `npc_spawn { id, name, role, description }` only for a genuinely new recurring character.",
      "SKILL CHECKS (R7.1) — at most ONE choice per scene may carry `skillCheck { statId, difficulty: 'easy'|'risky'|'desperate', successNote (≤90), failNote (≤90) }`: a gamble on a reader stat. The engine rolls it at submission and hands you the result (see CHECK OUTCOME) — never decide pass/fail yourself. A checked choice must NOT also carry `conditions`.",
      "SCARCITY (R10) — when the fiction has a price, state it in the choice text AND spend it (\"Pay the ferryman (-15 gold)\" + a `currency` effect of -15), and gate the costly option behind `currency_at_least`/`has_item` with a `lockedHint` so a reader who can't afford it sees a LOCKED door. Items are keys — an item gained should later unlock a gated choice or a check. WOUNDS PERSIST: express real harm as vitality loss PLUS a `delayed` drain thread.",
      "CODEX (R11.3) — record durable world-truths (a pact sworn, a name learned, a place burned) as string-valued `flag_set` effects with a kebab-case flag and a short SENTENCE value; the reader sees these as \"Truths the tome recorded\".",
    );
  }
  if (hasNpcSheets) {
    ruleBodies.push(
      "NPC MENTIONS — when the prose names an NPC by name (a recurring character with an identity, not a passing extra), include their id in `npcMentions`. Use the npc id from the \"Characters in scope\" section when present; for newly-introduced characters use a kebab-case slug of their name (e.g. \"mira-vale\"). This keeps the cast in scope for the next turn's prompt.",
    );
  }
  ruleBodies.push(
    "Do NOT include any text outside the single JSON object. No markdown fences, no preamble, no trailing commentary.",
    "ANCHORS (REQUIRED on turn 1 only). When `turn band === establish` AND this is turn 1, ALSO provide `protagonistAnchor` (one sentence describing the protagonist's face/build/clothing/era for a portrait — e.g. 'Korean woman late 30s, faded yellow rain jacket, short black hair, weathered hands, hazel eyes, painterly realism') and `settingAnchor` (one sentence describing the primary setting as an establishing shot — e.g. 'Pacific Northwest cove at dawn, gray fog over slick black rocks, distant fishing boats, painterly realism'). These prime the image renderer with reference portraits that anchor character + setting across the entire story. Both fields are IGNORED on subsequent turns — write them only at turn 1.",
  );
  // Turn-1 arc-production instruction (R1.1). Only when the caller asked for a
  // fresh arc (arc save's opening turn, arc not yet authored). Appended to the
  // output rules so it rides the same "emit this JSON" contract.
  if (request.produceArc) {
    ruleBodies.push(STORY_ARC_PRODUCTION_BLOCK);
  }
  const outputRules = [
    "Output rules — failure to follow these is rejected:",
    ...ruleBodies.map((body, i) => `${i + 1}. ${body}`),
  ].join("\n");
  return [
    opener,
    worldAnchor,
    turnContext,
    `Scene length: ${lengthInstruction(request.sceneLength, turnBand)}`,
    storySummaryBlock,
    // Pursuit section sits ABOVE the memory window — canonical spine before
    // scene texture (R6.1). The resolved check outcome (W2) rides just under it.
    pursuitBlock,
    checkOutcomeBlock,
    `Recent story memory (oldest → newest):\n${memory}`,
    `Current player state:\n${playerStateSummary(request.playerState)}`,
    npcSheetsBlock(request.npcSheets),
    matureLine,
    outputRules,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

function lengthInstruction(
  sceneLength: SceneGenerationRequest["sceneLength"],
  turnBand: "establish" | "develop" | "accelerate" = "establish",
): string {
  // The "establish" band uses richer length to set up the world; subsequent
  // bands trim length so the reader doesn't get the same sensory opener
  // padded with prose every turn.
  switch (sceneLength) {
    case "brief":
      return "1-2 short paragraphs for tutorial, fallback, or transition beats.";
    case "rich":
      return turnBand === "establish"
        ? "700-1000 words with layered sensory detail."
        : "400-600 words. Pick up where the prior scene left off and advance the situation; skip re-grounding the same setting.";
    case "chapter":
      return turnBand === "establish"
        ? "1200-1800 words paced as a novel chapter section, establishing the world before the choice surface."
        : "700-1100 words paced as a novel chapter continuation. Open IN the action; do not re-stage the setting; end with the provided choices.";
    case "standard":
    default:
      return turnBand === "establish"
        ? "3-5 readable paragraphs with concrete sensory detail."
        : turnBand === "accelerate"
          ? "2-3 tight paragraphs. Lead with action or dialogue. Skip re-grounding."
          : "2-4 paragraphs that ADVANCE the situation. One short paragraph of grounding maximum; the rest is what's NEW this scene.";
  }
}

function playerStateSummary(state: PlayerStateSnapshot | undefined): string {
  if (!state) return "(none provided)";
  // Render each inventory item with its description (which by convention
  // includes WHERE the item is right now: in hand, in pocket, hidden in
  // book on nightstand). The next scene MUST respect this location —
  // without it the model drifts (ticket placed in a book turns into
  // ticket in hand on the next turn).
  // Lead each item with its id in brackets so the model can copy the EXACT id
  // when gating a later choice on `has_item`/`missing_item` (a re-spelled id
  // silently locks the door forever — see ITEM-ID CONSISTENCY in the rules).
  const inventory = state.inventory.length > 0
    ? state.inventory
        .map((i) =>
          i.description
            ? `[${i.id}] ${i.label} — ${i.description}`
            : `[${i.id}] ${i.label}`,
        )
        .join("; ")
    : "empty";
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
    `- Inventory ([id] label — current location/state): ${inventory}`,
    `- Flags: ${flags}`,
  ].join("\n");
}
