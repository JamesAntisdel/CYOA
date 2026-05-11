/**
 * Unit tests for the pure DiscoverList filter helper. See note in
 * useToast.test.ts about the lack of a configured JS test runner — these
 * checks are deterministic and runnable via `node --import tsx`.
 */
import type { DiscoverTale } from "../DiscoverCard";
import { filterTales } from "../DiscoverList";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

const TALES: DiscoverTale[] = [
  {
    taleId: "t1",
    title: "Calm waters",
    synopsis: "A short lyrical drift.",
    tone: "calm",
    length: "short",
    tier: "free",
    completionCount: 0,
  },
  {
    taleId: "t2",
    title: "The tense corridor",
    synopsis: "A medium thriller.",
    tone: "tense",
    length: "medium",
    tier: "unlimited",
    completionCount: 12,
  },
  {
    taleId: "t3",
    title: "Pro grim epic",
    synopsis: "Long, grim, gorgeous.",
    tone: "grim",
    length: "long",
    tier: "pro",
    completionCount: 250,
  },
];

export function runDiscoverListTests(): void {
  // Default filters return every tale
  {
    const result = filterTales(TALES, {
      tone: "any",
      length: "any",
      tier: "any",
      minCompletions: 0,
    });
    assert(result.length === 3, "no filters returns all tales");
  }

  // Tone filter narrows
  {
    const result = filterTales(TALES, {
      tone: "calm",
      length: "any",
      tier: "any",
      minCompletions: 0,
    });
    assert(result.length === 1, "tone filter narrows");
    assert(result[0]?.taleId === "t1", "tone filter returns t1");
  }

  // Length + tier combine
  {
    const result = filterTales(TALES, {
      tone: "any",
      length: "long",
      tier: "pro",
      minCompletions: 0,
    });
    assert(result.length === 1, "length+tier filter narrows");
    assert(result[0]?.taleId === "t3", "length+tier returns t3");
  }

  // Minimum completions threshold
  {
    const result = filterTales(TALES, {
      tone: "any",
      length: "any",
      tier: "any",
      minCompletions: 10,
    });
    assert(result.length === 2, "10+ completions returns two tales");
    assert(
      result.every((t) => (t.completionCount ?? 0) >= 10),
      "all results meet the threshold",
    );
  }

  // Filters that exclude everything return an empty list
  {
    const result = filterTales(TALES, {
      tone: "wry",
      length: "any",
      tier: "any",
      minCompletions: 0,
    });
    assert(result.length === 0, "no matches returns empty");
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runDiscoverListTests();
  // eslint-disable-next-line no-console
  console.log("DiscoverList tests passed");
}
