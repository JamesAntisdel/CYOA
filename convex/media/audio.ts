import type { AccountRecord } from "../account";
import { assertProMediaAllowed, type AmbientLoopProjection } from "../assets";
import type { EntitlementRecord } from "../billing/entitlements";

export type AmbientLoop = AmbientLoopProjection & {
  provider: "uploaded";
  entitlementRequired: "pro";
};

export type AmbientState = {
  muted: boolean;
  reducedMotion: boolean;
  nativeAppState: "active" | "background" | "inactive";
};

const AMBIENT_LIBRARY: AmbientLoop[] = [
  {
    id: "cathedral-hum",
    uri: "asset://ambient/cathedral-hum.opus",
    label: "Cathedral hum",
    tags: ["cathedral", "sacred", "stone"],
    volume: 0.36,
    provider: "uploaded",
    entitlementRequired: "pro",
  },
  {
    id: "distant-rain",
    uri: "asset://ambient/distant-rain.opus",
    label: "Distant rain",
    tags: ["rain", "night", "outside"],
    volume: 0.3,
    provider: "uploaded",
    entitlementRequired: "pro",
  },
  {
    id: "candle-crackle",
    uri: "asset://ambient/candle-crackle.opus",
    label: "Candle crackle",
    tags: ["candle", "library", "quiet"],
    volume: 0.22,
    provider: "uploaded",
    entitlementRequired: "pro",
  },
];

export function selectAmbientLoop(input: {
  account: Pick<AccountRecord, "ageBand" | "matureContentEnabled"> & { _id?: string | undefined };
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined;
  sceneTags: string[];
  theme: "day" | "night" | "sepia";
  promptText: string;
  state: AmbientState;
}): AmbientLoopProjection | undefined {
  if (!ambientPlaybackAllowed(input.state)) return undefined;
  assertProMediaAllowed({
    account: input.account,
    entitlement: input.entitlement,
    prompt: input.promptText,
  });

  const tags = new Set([...input.sceneTags, input.theme]);
  const scored = AMBIENT_LIBRARY.map((loop) => ({
    loop,
    score: loop.tags.reduce((total, tag) => total + (tags.has(tag) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);

  const selected = scored.find((entry) => entry.score > 0)?.loop ?? AMBIENT_LIBRARY[2] ?? AMBIENT_LIBRARY[0];
  if (!selected) return undefined;
  return {
    id: selected.id,
    uri: selected.uri,
    label: selected.label,
    tags: selected.tags,
    volume: selected.volume,
  };
}

export function ambientPlaybackAllowed(state: AmbientState): boolean {
  return !state.muted && !state.reducedMotion && state.nativeAppState === "active";
}

export function listAmbientLoops(): AmbientLoop[] {
  return AMBIENT_LIBRARY.map((loop) => ({ ...loop, tags: [...loop.tags] }));
}
