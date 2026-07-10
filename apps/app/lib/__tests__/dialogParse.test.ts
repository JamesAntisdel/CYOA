/**
 * Tests for the render-time dialog parser. Each case asserts the shape
 * of the block sequence (kind + speaker + text). The parser is
 * intentionally lossy on attribution — when nothing matches a quote it
 * still becomes a dialog block, just without a speaker label. That
 * "good enough" behavior is part of the spec and is asserted here.
 *
 * Run:
 *   pnpm --filter @cyoa/convex exec vitest run -c apps/app/vitest.config.ts \
 *     apps/app/lib/__tests__/dialogParse.test.ts
 */
import { describe, expect, it } from "vitest";

import { parseProseToBlocks, type DialogBlock } from "../dialogParse";

function dialog(text: string, speaker?: string): DialogBlock {
  return speaker ? { kind: "dialog", speaker, text } : { kind: "dialog", text };
}

function prose(text: string): DialogBlock {
  return { kind: "prose", text };
}

describe("parseProseToBlocks", () => {
  it("returns an empty array for empty input", () => {
    expect(parseProseToBlocks("")).toEqual([]);
  });

  it("treats pure narration as a single prose block", () => {
    const input =
      "The room was dim. Candles flickered along the wall. A draft moved the curtain.";
    expect(parseProseToBlocks(input)).toEqual([prose(input)]);
  });

  it("recognizes a standalone quoted line as dialog with no speaker", () => {
    expect(parseProseToBlocks(`"You can't be serious."`)).toEqual([
      dialog("You can't be serious."),
    ]);
  });

  it("extracts the speaker from attribution after the quote", () => {
    const input = `"Hello there," she said.`;
    expect(parseProseToBlocks(input)).toEqual([
      dialog("Hello there,", "she"),
    ]);
  });

  it("extracts the speaker from attribution before the quote", () => {
    const input = `Mira said, "I won't help you."`;
    expect(parseProseToBlocks(input)).toEqual([
      dialog("I won't help you.", "Mira"),
    ]);
  });

  it("recognizes script-style speaker prefixes", () => {
    expect(parseProseToBlocks("Mira: I won't help you.")).toEqual([
      dialog("I won't help you.", "Mira"),
    ]);
  });

  it("does NOT mis-classify a descriptive colon as a script line", () => {
    // "Mira: she watched" is a narrative colon, not an utterance.
    expect(parseProseToBlocks("Mira: she watched the door for a long moment.")).toEqual([
      prose("Mira: she watched the door for a long moment."),
    ]);
  });

  it("interleaves prose and dialog blocks in narrative order", () => {
    const input = [
      "The threshold was warm beneath her feet.",
      `"You can't be serious."`,
      `"Watch me," she muttered.`,
      "The lantern guttered once and went out.",
    ].join(" ");

    expect(parseProseToBlocks(input)).toEqual([
      prose("The threshold was warm beneath her feet."),
      dialog("You can't be serious."),
      dialog("Watch me,", "she"),
      prose("The lantern guttered once and went out."),
    ]);
  });

  it("accepts smart quotes the same as straight quotes", () => {
    const input = `“Hello there,” she said.`;
    const result = parseProseToBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("dialog");
    if (result[0]?.kind === "dialog") {
      expect(result[0].speaker).toBe("she");
      expect(result[0].text).toContain("Hello there");
    }
  });

  it("merges adjacent prose sentences into one block", () => {
    const input = "First sentence. Second sentence. Third sentence.";
    expect(parseProseToBlocks(input)).toEqual([
      prose("First sentence. Second sentence. Third sentence."),
    ]);
  });

  it("merges adjacent same-speaker dialog into one turn", () => {
    const input = [
      `"I told you once," she said.`,
      `"I won't tell you again," she said.`,
    ].join(" ");
    const result = parseProseToBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("dialog");
    if (result[0]?.kind === "dialog") {
      expect(result[0].speaker).toBe("she");
      expect(result[0].text).toContain("I told you once");
      expect(result[0].text).toContain("I won't tell you again");
    }
  });

  it("treats a leading-ellipsis continuation as the same speaker", () => {
    const input = [
      `"I crossed the river," Mira said.`,
      `"...and then she vanished."`,
    ].join(" ");
    const result = parseProseToBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("dialog");
    if (result[0]?.kind === "dialog") {
      expect(result[0].speaker).toBe("Mira");
      expect(result[0].text).toContain("and then she vanished");
    }
  });

  it("does not merge dialog from different speakers", () => {
    const input = [`"Stop," Mira said.`, `"No," Vex replied.`].join(" ");
    const result = parseProseToBlocks(input);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind === "dialog" && result[0].speaker).toBe("Mira");
    expect(result[1]?.kind === "dialog" && result[1].speaker).toBe("Vex");
  });

  it("does not merge dialog across a paragraph break", () => {
    const input = [
      `"You can't be serious."`,
      ``,
      `"You can't be serious."`,
    ].join("\n");
    // Two unattributed dialog lines separated by a paragraph break should
    // remain as two separate blocks even though they're identical — the
    // paragraph break is a hard boundary.
    const result = parseProseToBlocks(input);
    expect(result).toHaveLength(2);
    expect(result.every((b) => b.kind === "dialog")).toBe(true);
  });

  it("emits a partially-streamed final fragment as prose", () => {
    // Streaming: the model has typed the opening quote but not the
    // closing one yet. The parser should leave it as prose until the
    // sentence is complete rather than emitting a mangled dialog block.
    const input = `The lantern guttered. "Hello th`;
    const result = parseProseToBlocks(input);
    // First block is the complete prose sentence. The trailing fragment
    // either tails onto that prose block or sits as its own prose tail —
    // either way it MUST NOT be a dialog block (no closing quote yet).
    expect(result.every((b) => b.kind === "prose")).toBe(true);
  });

  it("handles a multi-word speaker name", () => {
    const input = `"Hello," Sister Anne said.`;
    expect(parseProseToBlocks(input)).toEqual([
      dialog("Hello,", "Sister Anne"),
    ]);
  });

  it("handles dialog followed by narrator description", () => {
    const input = `"I'm fine," Mira said. She turned away.`;
    expect(parseProseToBlocks(input)).toEqual([
      dialog("I'm fine,", "Mira"),
      prose("She turned away."),
    ]);
  });

  it("does not throw on input with unmatched smart quotes", () => {
    // Defensive: make sure a degenerate streamed string doesn't crash.
    expect(() => parseProseToBlocks(`“Incomplete`)).not.toThrow();
  });
});
