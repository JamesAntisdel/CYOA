// DOORS-JOURNAL pure client logic (lib/storyEngagement.ts): the tome-voice
// line per journal state and the teased → key-in-hand transition detection
// that drives the one-shot "A key has turned up." nudge. Behavioral coverage
// lives here; the RN wiring is drift-guarded in
// components/reading/__tests__/doorsJournal.test.mjs.

import { describe, expect, it } from "vitest";

import type { RemoteDoorsJournalEntry } from "../gameApi";
import { doorJournalLine, doorsNewlyKeyed } from "../storyEngagement";

function entry(
  label: string,
  state: RemoteDoorsJournalEntry["state"],
  hint = "",
): RemoteDoorsJournalEntry {
  return { label, hint, state };
}

describe("doorJournalLine", () => {
  it("speaks in the tome voice per state, capitalizing the door label", () => {
    expect(doorJournalLine(entry("the crypt gate", "teased"))).toBe(
      "The crypt gate remembers you.",
    );
    expect(doorJournalLine(entry("the crypt gate", "key-in-hand"))).toBe(
      "The crypt gate — a key has turned up.",
    );
    expect(doorJournalLine(entry("the crypt gate", "opened"))).toBe(
      "The crypt gate stands open.",
    );
  });

  it("keeps an already-capitalized label and falls back on an empty one", () => {
    expect(doorJournalLine(entry("Night Pass", "teased"))).toBe("Night Pass remembers you.");
    expect(doorJournalLine(entry("   ", "teased"))).toBe("The door remembers you.");
  });
});

describe("doorsNewlyKeyed", () => {
  it("detects a teased → key-in-hand transition between snapshots", () => {
    const prev = [entry("the crypt gate", "teased"), entry("the ferry chain", "teased")];
    const next = [entry("the crypt gate", "key-in-hand"), entry("the ferry chain", "teased")];
    expect(doorsNewlyKeyed(prev, next)).toEqual(["the crypt gate"]);
  });

  it("never nudges on the first load (no previous snapshot) or a null fetch", () => {
    expect(doorsNewlyKeyed(undefined, [entry("the crypt gate", "key-in-hand")])).toEqual([]);
    expect(doorsNewlyKeyed([entry("the crypt gate", "teased")], null)).toEqual([]);
    expect(doorsNewlyKeyed([entry("the crypt gate", "teased")], undefined)).toEqual([]);
  });

  it("ignores doors that were already key-in-hand, newly teased, or opened", () => {
    const prev = [
      entry("the crypt gate", "key-in-hand"),
      entry("the ferry chain", "teased"),
    ];
    const next = [
      entry("the crypt gate", "key-in-hand"),
      // teased → opened skips the key-in-hand stop (opened via the door event)
      entry("the ferry chain", "opened"),
      // brand-new key-in-hand entry with no teased history → no nudge
      entry("the under-stair dark", "key-in-hand"),
    ];
    expect(doorsNewlyKeyed(prev, next)).toEqual([]);
  });
});
