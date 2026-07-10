/* eslint-disable @typescript-eslint/no-explicit-any */
// Self-contained behavioural tests for useNarratorVoice. The app workspace
// does not bundle vitest, so this module exposes a `runTests()` entrypoint
// and an in-file assertion harness instead of importing a test runner. A
// future wave can wire this file up to vitest by adding the dep and adopting
// the harness functions as `it()` callbacks — the assertions stay correct.

import {
  DEFAULT_VOICE_ID,
  NARRATOR_VOICES,
  __internal,
  getNarratorVoice,
  resolveInitialVoiceState,
} from "../useNarratorVoice";

type TestCase = {
  name: string;
  run: () => void;
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)} but got ${String(actual)}`);
  }
}

class MemoryStorage {
  private store = new Map<string, string>();
  getItem = (k: string): string | null => (this.store.has(k) ? this.store.get(k)! : null);
  setItem = (k: string, v: string): void => {
    this.store.set(k, v);
  };
  removeItem = (k: string): void => {
    this.store.delete(k);
  };
  clear = (): void => {
    this.store.clear();
  };
  snapshot = (): Record<string, string> => Object.fromEntries(this.store.entries());
}

function withStorage(fn: (storage: MemoryStorage) => void): void {
  const storage = new MemoryStorage();
  const g = globalThis as { localStorage?: Storage };
  const prior = g.localStorage;
  g.localStorage = storage as unknown as Storage;
  try {
    fn(storage);
  } finally {
    if (prior) {
      g.localStorage = prior;
    } else {
      delete g.localStorage;
    }
  }
}

export const tests: TestCase[] = [
  {
    name: "exposes a stable six-voice seed list with the agreed names",
    run: () => {
      assertEqual(NARRATOR_VOICES.length, 6, "voice count");
      const names = NARRATOR_VOICES.map((v) => v.name).sort();
      assertEqual(names.join(","), "Ash,Beren,Fen,Lark,Mira,Vix", "voice names");
      for (const v of NARRATOR_VOICES) {
        assert(v.id.startsWith("voice."), `voice id prefix on ${v.id}`);
      }
    },
  },
  {
    name: "default voice id resolves to the first seeded voice",
    run: () => {
      assertEqual(DEFAULT_VOICE_ID, NARRATOR_VOICES[0]!.id, "default voice");
      assertEqual(getNarratorVoice(DEFAULT_VOICE_ID).name, "Ash", "default voice name");
    },
  },
  {
    name: "getNarratorVoice falls back to the first voice on unknown id",
    run: () => {
      const fallback = getNarratorVoice("voice.unknown");
      assertEqual(fallback.id, NARRATOR_VOICES[0]!.id, "fallback voice");
    },
  },
  {
    name: "writePinned stores both per-save and last-used keys",
    run: () => {
      withStorage((storage) => {
        __internal.writePinned("save-abc", "voice.lark");
        const snap = storage.snapshot();
        assertEqual(snap[__internal.perSaveKey("save-abc")], "voice.lark", "per-save key");
        assertEqual(snap[__internal.LAST_USED_KEY], "voice.lark", "last-used key");
      });
    },
  },
  {
    name: "readPinned rejects unknown voice ids in storage",
    run: () => {
      withStorage(() => {
        // Manually poke a bad value into storage.
        const g = globalThis as { localStorage?: Storage };
        g.localStorage!.setItem(__internal.perSaveKey("save-x"), "voice.ghost");
        assertEqual(__internal.readPinned("save-x"), null, "rejects unknown id");
      });
    },
  },
  {
    name: "readPinned returns the stored voice when it is a known id",
    run: () => {
      withStorage(() => {
        __internal.writePinned("save-y", "voice.beren");
        assertEqual(__internal.readPinned("save-y"), "voice.beren", "round-trip");
      });
    },
  },
  {
    name: "per-save key shape matches cyoa.narratorVoice.<saveId>.v1",
    run: () => {
      assertEqual(__internal.perSaveKey("abc"), "cyoa.narratorVoice.abc.v1", "key shape");
    },
  },
  {
    name: "two parallel saves keep two voices",
    run: () => {
      withStorage(() => {
        __internal.writePinned("cathedral", "voice.ash");
        __internal.writePinned("iron-court", "voice.lark");
        assertEqual(__internal.readPinned("cathedral"), "voice.ash", "first save");
        assertEqual(__internal.readPinned("iron-court"), "voice.lark", "second save");
      });
    },
  },
  {
    name: "last-used reflects the most recent pin and survives across saves",
    run: () => {
      withStorage(() => {
        __internal.writePinned("a", "voice.ash");
        __internal.writePinned("b", "voice.vix");
        assertEqual(__internal.readLastUsed(), "voice.vix", "most-recent");
      });
    },
  },
  {
    name: "writeLastUsed updates lastUsed without touching a per-save key",
    run: () => {
      withStorage((storage) => {
        __internal.writeLastUsed("voice.fen");
        const snap = storage.snapshot();
        assertEqual(snap[__internal.LAST_USED_KEY], "voice.fen", "last-used key");
        // Ensure no stray per-save key was written.
        const keys = Object.keys(snap);
        assertEqual(
          keys.filter((k) => k.startsWith("cyoa.narratorVoice.") && k !== __internal.LAST_USED_KEY).length,
          0,
          "no per-save key",
        );
      });
    },
  },
  {
    name: "resolveInitialVoiceState(null) falls back to DEFAULT_VOICE_ID when no lastUsed",
    run: () => {
      withStorage(() => {
        const state = resolveInitialVoiceState(null);
        assertEqual(state.voiceId, DEFAULT_VOICE_ID, "default voice");
        assertEqual(state.status, "fresh", "fresh status");
      });
    },
  },
  {
    name: "useNarratorVoice(null) reads lastUsed from storage at mount",
    run: () => {
      withStorage(() => {
        // Simulate a previous session having written a lastUsed voice.
        __internal.writeLastUsed("voice.mira");
        // resolveInitialVoiceState is the exact state the hook seeds on mount
        // when saveId === null (library / creator / cover / settings).
        const state = resolveInitialVoiceState(null);
        assertEqual(state.voiceId, "voice.mira", "mounts to lastUsed voice");
        assertEqual(state.status, "fresh", "no per-save pin");
      });
    },
  },
  {
    name: "settings pickVoice -> writes lastUsed -> library hook reads it on remount",
    run: () => {
      withStorage(() => {
        // Settings page now passes saveId=null to useNarratorVoice. The
        // hook's pickVoice in that branch calls writeLastUsed so the choice
        // becomes account-wide. Simulate the write the hook performs.
        __internal.writeLastUsed("voice.lark");
        // Now /library remounts with useNarratorVoice(null) and reads:
        const onLibraryMount = resolveInitialVoiceState(null);
        assertEqual(onLibraryMount.voiceId, "voice.lark", "library picks up settings choice");
        // And /creator does the same.
        const onCreatorMount = resolveInitialVoiceState(null);
        assertEqual(onCreatorMount.voiceId, "voice.lark", "creator picks up settings choice");
        // The read screen with a fresh save id sees no per-save pin yet, so
        // it also falls back to the settings-chosen voice — preserving the
        // "fresh -> pinned" pin-on-first-click semantics.
        const onReadMount = resolveInitialVoiceState("new-save-123");
        assertEqual(onReadMount.voiceId, "voice.lark", "read screen seeded from lastUsed");
        assertEqual(onReadMount.status, "fresh", "read screen still pin-on-first-click");
      });
    },
  },
  {
    name: "resolveInitialVoiceState(saveId) returns pinned voice when one exists",
    run: () => {
      withStorage(() => {
        __internal.writePinned("save-cathedral", "voice.beren");
        // Pin a different lastUsed afterward to make sure per-save wins.
        __internal.writeLastUsed("voice.lark");
        const state = resolveInitialVoiceState("save-cathedral");
        assertEqual(state.voiceId, "voice.beren", "per-save voice wins");
        assertEqual(state.status, "pinned", "pinned status");
      });
    },
  },
  {
    name: "the seed list includes the voices referenced in tests",
    run: () => {
      // Guard rail: if a voice id used elsewhere in tests is renamed, this
      // surfaces the breakage in one place instead of seven scattered ones.
      const ids = new Set(NARRATOR_VOICES.map((v) => v.id));
      for (const id of ["voice.ash", "voice.lark", "voice.beren", "voice.vix", "voice.fen", "voice.mira"]) {
        if (!ids.has(id)) throw new Error(`expected seed voice ${id}`);
      }
    },
  },
];

export function runTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  for (const t of tests) {
    try {
      t.run();
      passed += 1;
    } catch (err) {
      failures.push(`${t.name}: ${(err as Error).message}`);
    }
  }
  return { passed, failed: failures.length, failures };
}
