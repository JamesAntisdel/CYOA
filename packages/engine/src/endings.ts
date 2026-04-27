import type { EngineDiff, EngineEvent, PlayerState, Story } from "./types";

export function unlockCurrentEnding(
  state: PlayerState,
  story: Story,
  diffs: EngineDiff[],
  events: EngineEvent[],
): void {
  const node = story.nodes[state.currentNodeId];
  if (!node?.endingId || state.endingsUnlocked[node.endingId]) return;
  const ending = story.endings[node.endingId];
  if (!ending) return;

  state.endingsUnlocked[node.endingId] = {
    storyId: story.id,
    endingId: node.endingId,
    firstSeenTurn: state.turnNumber,
    mode: state.mode,
    path: [...state.path],
  };
  diffs.push({ kind: "ending", target: node.endingId, delta: 1 });
  events.push({ kind: "ending_unlocked", endingId: node.endingId });
}
