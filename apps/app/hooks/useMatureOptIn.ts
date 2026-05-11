import { useCallback, useEffect, useMemo, useState } from "react";

const MATURE_OPT_IN_KEY = "cyoa.matureOptIn.v1";
const UNDER_13_BLOCK_KEY = "cyoa.under13Block.v1";

type MatureState = {
  enabled: boolean;
  consentedAt: number | null;
};

const defaultState: MatureState = {
  enabled: false,
  consentedAt: null,
};

export function useMatureOptIn() {
  const [state, setState] = useState<MatureState>(defaultState);

  useEffect(() => {
    setState(readMatureState());
  }, []);

  const enableMature = useCallback(() => {
    const next: MatureState = { enabled: true, consentedAt: Date.now() };
    writeMatureState(next);
    setState(next);
  }, []);

  const revokeMature = useCallback(() => {
    const next: MatureState = { enabled: false, consentedAt: null };
    writeMatureState(next);
    setState(next);
  }, []);

  return useMemo(
    () => ({
      ...state,
      enableMature,
      revokeMature,
    }),
    [enableMature, revokeMature, state],
  );
}

/**
 * Under-13 block is permanent. There is no reset path through the UI.
 */
export function useUnder13Block() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    setBlocked(readUnder13Block());
  }, []);

  const setUnder13Block = useCallback(() => {
    writeUnder13Block();
    setBlocked(true);
  }, []);

  return { blocked, setUnder13Block };
}

function readMatureState(): MatureState {
  const storage = getStorage();
  if (!storage) return defaultState;

  try {
    const raw = storage.getItem(MATURE_OPT_IN_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<MatureState>;
    if (typeof parsed.enabled !== "boolean") return defaultState;
    return {
      enabled: parsed.enabled,
      consentedAt: typeof parsed.consentedAt === "number" ? parsed.consentedAt : null,
    };
  } catch {
    return defaultState;
  }
}

function writeMatureState(state: MatureState): void {
  getStorage()?.setItem(MATURE_OPT_IN_KEY, JSON.stringify(state));
}

function readUnder13Block(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(UNDER_13_BLOCK_KEY) === "true";
  } catch {
    return false;
  }
}

function writeUnder13Block(): void {
  getStorage()?.setItem(UNDER_13_BLOCK_KEY, "true");
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}
