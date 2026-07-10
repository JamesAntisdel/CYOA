import type { HudMode } from "../../hooks/useReaderSettings";

/** HUD modes the layouts understand; "hidden" is collapsed into "off". */
export type ReaderHudMode = "full" | "quiet" | "hidden";

export function hudModeFromSettings(mode: HudMode): ReaderHudMode {
  return mode;
}
