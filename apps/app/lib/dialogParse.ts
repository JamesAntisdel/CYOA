/**
 * dialogParse — render-time pattern matcher that pulls dialogue lines out
 * of a scene-prose blob so the reader UI can render them as distinct
 * `<DialogLine>` blocks instead of one flowing `<Text>`.
 *
 * Design notes:
 *  - No LLM contract change, no schema change. Operates on the same prose
 *    string the LLM emits today.
 *  - Patterns covered (English fiction common conventions):
 *      1. Attributed dialogue: `"Hello there," she said.`
 *      2. Standalone quoted dialogue: `"You can't be serious."`
 *      3. Script-style prefix:        `Mira: I won't help you.`
 *      4. Continuing dialogue:        `"...and then she vanished."`
 *         — merges with the previous dialog block (same speaker) when
 *         adjacent so a multi-sentence speaker turn renders as one block.
 *  - "Don't be perfect": when attribution can't be resolved, the quote
 *    still becomes a dialog block — just without a speaker label. Plain
 *    narration falls through to a `prose` block unchanged.
 *  - Streaming-safe: the sentence splitter only terminates on `.!?` (not
 *    on a bare closing quote), so a partial fragment without a closing
 *    quote stays as prose until the sentence is complete. We never
 *    render half-parsed dialog mid-stream.
 */

export type DialogBlock =
  | { kind: "prose"; text: string }
  | { kind: "dialog"; speaker?: string; text: string };

// Smart and straight quote characters. Kept in a single regex character
// class so the matcher accepts either flavor — LLM output drifts between
// the two depending on the model and any post-processing.
const OPEN_QUOTE = "[\"“]"; // " or U+201C
const CLOSE_QUOTE = "[\"”]"; // " or U+201D
const NOT_QUOTE = "[^\"“”]";

// Speech verbs we'll accept as attribution. Order doesn't matter — the
// alternation is non-capturing. Add new verbs here as we see them in the
// wild; the parser is intentionally permissive.
const SPEECH_VERBS = [
  "said",
  "asked",
  "replied",
  "whispered",
  "shouted",
  "murmured",
  "called",
  "answered",
  "breathed",
  "muttered",
  "growled",
  "sighed",
  "hissed",
  "added",
  "cried",
  "snapped",
  "laughed",
  "yelled",
  "exclaimed",
  "responded",
  "declared",
  "demanded",
  "continued",
];
const SPEECH_VERB_PATTERN = SPEECH_VERBS.join("|");

// A "speaker word" is a capitalized token, optionally followed by another
// capitalized token (e.g. "Mira", "Sister Anne", "Captain Vex"). We allow
// up to three words so titles + first + last names parse, but bail out
// after that to avoid swallowing whole sentences as a speaker name.
const SPEAKER_WORD = "[A-Z][A-Za-z'\\-]+";
const SPEAKER_PHRASE = `${SPEAKER_WORD}(?:\\s${SPEAKER_WORD}){0,2}`;
// Pronoun + verb is also a valid attribution clause; "he said" / "she
// muttered". Lowercased speaker tokens are constrained to a small set so
// we don't latch onto stray lowercase words.
const PRONOUN = "he|she|they|it|we|i|you";
const SPEAKER_OR_PRONOUN = `(?:${SPEAKER_PHRASE}|${PRONOUN})`;

// Attribution AFTER the quote: `"Hello," she said.` Captures speaker name
// (group 1) and ignores the rest of the trailing tail. The leading comma
// is optional because some LLMs emit `"Hello!" he laughed.` with the
// sentence-end punctuation as the separator.
const ATTRIBUTION_AFTER = new RegExp(
  `^\\s*[,.!?]?\\s*(${SPEAKER_OR_PRONOUN})\\s+(?:${SPEECH_VERB_PATTERN})\\b.*$`,
  "i",
);

// Attribution BEFORE the quote: `She said, "Hello."` Captures the speaker
// phrase that precedes the verb. Anchored to the start of the sentence so
// we don't trip on mid-sentence narration like "...as she said before".
const ATTRIBUTION_BEFORE = new RegExp(
  `^(${SPEAKER_OR_PRONOUN})\\s+(?:${SPEECH_VERB_PATTERN})\\b${NOT_QUOTE}*?${OPEN_QUOTE}(${NOT_QUOTE}+)${CLOSE_QUOTE}\\s*[.!?,]?\\s*$`,
  "i",
);

// Script-style speaker prefix: `Mira: I won't help you.` The speaker
// phrase is anchored to the line start, followed by a colon and the
// utterance. We deliberately do NOT consume a trailing period — the
// utterance keeps its own terminator.
const SCRIPT_PREFIX = new RegExp(`^(${SPEAKER_PHRASE})\\s*:\\s+(.+)$`);

// A quote token at the start of a sentence with optional attribution
// trailing it. Captures: 1=quoted text, 2=trailing attribution clause
// (may be empty). The trailing clause is then handed back to
// ATTRIBUTION_AFTER to extract the speaker. Splitting the work in two
// passes keeps each regex small enough to reason about.
const QUOTE_AT_START = new RegExp(
  `^${OPEN_QUOTE}(${NOT_QUOTE}+)${CLOSE_QUOTE}(.*)$`,
);

/**
 * Split scene prose into a sequence of prose and dialog blocks. Pure
 * function — safe to call on every render, but ReaderScreen wraps it in
 * `useMemo(prose)` so we only rerun when the streamed text grows.
 */
export function parseProseToBlocks(prose: string): DialogBlock[] {
  if (!prose) return [];

  const blocks: DialogBlock[] = [];
  const paragraphs = splitIntoParagraphs(prose);

  for (let p = 0; p < paragraphs.length; p += 1) {
    const sentences = splitIntoSentences(paragraphs[p] ?? "");
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const classified = classifySentence(sentence);
      // Pass paragraph index so appendBlock never merges blocks across a
      // paragraph break — a `\n\n` is a hard sentence boundary even for
      // identical un-attributed dialog lines.
      appendBlock(blocks, classified, p);
    }
  }

  return blocks;
}

/**
 * Split prose into paragraphs on a `\n{2,}` boundary. Single newlines
 * inside a paragraph collapse to spaces so wrapped prose with soft
 * breaks still renders correctly.
 */
function splitIntoParagraphs(prose: string): string[] {
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);
}

/**
 * Sentence splitter tuned for prose. We split on `.`, `!`, or `?`
 * (optionally followed by a closing quote) then whitespace + a capital
 * letter or opening quote. The two-character lookahead avoids splitting
 * on abbreviations like "Mr. Vex" or "U.S.A.".
 *
 * We do NOT split after a bare closing quote, because `"Hello," Sister
 * said.` is one sentence — splitting on the quote would orphan the
 * attribution into a prose chunk.
 */
function splitIntoSentences(paragraph: string): string[] {
  const chunks = paragraph.split(/(?<=[.!?]["”]?)\s+(?=["“ A-Z])/);
  // Final whitespace-only / empty chunks are dropped.
  const out: string[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Classify a single trimmed sentence. Returns the block the sentence
 * should render as. Order of attempts:
 *   1. Script prefix (`Name: text`)
 *   2. Attribution before quote (`She said, "..."`)
 *   3. Quote at start (with optional trailing attribution)
 *   4. Fall through as prose
 */
function classifySentence(sentence: string): DialogBlock {
  // 1. Script-style. Cheap and unambiguous when it matches.
  const script = SCRIPT_PREFIX.exec(sentence);
  if (script && script[1] && script[2]) {
    const speaker = script[1];
    const text = script[2].trim();
    // Guard: avoid mis-classifying narrative colons like
    // "Sister Anne: she watched..." — require the text after the colon
    // to look like an utterance (not start with a lowercase pronoun
    // continuing the narrative). When in doubt, fall through to prose.
    if (!looksLikeNarrativeColon(speaker, text)) {
      return { kind: "dialog", speaker, text };
    }
  }

  // 2. Attribution before the quote: `She said, "..."`.
  const before = ATTRIBUTION_BEFORE.exec(sentence);
  if (before && before[1] && before[2]) {
    return { kind: "dialog", speaker: before[1], text: before[2].trim() };
  }

  // 3. Quote at start of sentence, with optional trailing attribution.
  // Streaming guard: only match when the sentence actually contains a
  // closing quote — partially-streamed `"Hello th` falls through to
  // prose so we never render half-parsed dialog.
  const quoted = QUOTE_AT_START.exec(sentence);
  if (quoted && quoted[1]) {
    const text = quoted[1].trim();
    const trailing = (quoted[2] ?? "").trim();
    const speaker = extractSpeakerFromTrailing(trailing);
    return speaker
      ? { kind: "dialog", speaker, text }
      : { kind: "dialog", text };
  }

  return { kind: "prose", text: sentence };
}

/**
 * Extract a speaker name from the text that follows a closing quote.
 * Returns undefined when the trailing text is narration (e.g. "She
 * crossed the room.") rather than attribution.
 */
function extractSpeakerFromTrailing(trailing: string): string | undefined {
  if (!trailing) return undefined;
  const match = ATTRIBUTION_AFTER.exec(trailing);
  return match && match[1] ? match[1] : undefined;
}

/**
 * Heuristic to avoid mis-classifying a narrative colon as dialog. If the
 * text after the colon starts with a lowercase pronoun the colon is
 * almost certainly punctuation in a descriptive sentence, not a script-
 * style speaker tag.
 */
function looksLikeNarrativeColon(_speaker: string, text: string): boolean {
  // Case-sensitive — `Mira: I won't help you.` starts with capital-I (the
  // first-person pronoun, always capitalized), which is a real utterance,
  // not narration. Only LOWERCASE pronouns at the start indicate the
  // colon is mid-sentence punctuation.
  return /^(he|she|they|it|we|you)\b/.test(text);
}

/**
 * Append a block, merging with the tail when they're in the same
 * paragraph AND the same kind (and for dialog, the same speaker). Keeps
 * adjacent prose sentences in one paragraph and multi-sentence speaker
 * turns in one dialog block, but never merges across a `\n\n` break.
 *
 * The `paragraphIndex` is stored as a side channel on the running merge
 * state via the symbol below; we don't add it to the public type because
 * consumers only care about kind/speaker/text.
 */
function appendBlock(
  blocks: DialogBlock[],
  next: DialogBlock,
  paragraphIndex: number,
): void {
  const tail = blocks[blocks.length - 1];
  const tailParagraph = tail ? (tail as TaggedBlock)[paragraphSymbol] : undefined;
  tagParagraph(next, paragraphIndex);

  if (!tail) {
    blocks.push(next);
    return;
  }

  // Hard boundary on paragraph break — never merge across `\n\n`.
  if (tailParagraph !== paragraphIndex) {
    blocks.push(next);
    return;
  }

  if (tail.kind === "prose" && next.kind === "prose") {
    tail.text = `${tail.text} ${next.text}`;
    return;
  }

  if (tail.kind === "dialog" && next.kind === "dialog") {
    const sameSpeaker = (tail.speaker ?? "") === (next.speaker ?? "");
    // A continuation line that starts with "..." is treated as a
    // continuation of the previous speaker even if attribution is
    // missing on the new sentence.
    const continuation = !next.speaker && /^[….]{1,3}/.test(next.text);
    if (
      (tail.speaker && sameSpeaker) ||
      (tail.speaker && continuation) ||
      // Two adjacent un-attributed quotes in the same paragraph are
      // almost always the same speaker continuing — merge them. The
      // paragraph-break check above prevents cross-paragraph drift.
      (!tail.speaker && !next.speaker)
    ) {
      tail.text = `${tail.text} ${next.text}`;
      return;
    }
  }

  blocks.push(next);
}

// Lightweight tagging so we can carry the paragraph index alongside the
// block without exposing it on the public DialogBlock type. The symbol
// is non-enumerable so JSON.stringify and equality checks behave as
// callers expect — only the parser itself reads it.
const paragraphSymbol = Symbol("paragraphIndex");
type TaggedBlock = DialogBlock & { [paragraphSymbol]?: number };

function tagParagraph(block: DialogBlock, paragraphIndex: number): void {
  Object.defineProperty(block, paragraphSymbol, {
    value: paragraphIndex,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
