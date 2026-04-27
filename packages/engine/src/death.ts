import type { EngineDiff, EngineEvent, PlayerState, Story, TerminalResult } from "./types";

export function resolveDeath(
  state: PlayerState,
  story: Story,
  diffs: EngineDiff[],
  events: EngineEvent[],
): void {
  if (state.vitality > 0 || !story.deathNodeId) return;
  if (state.currentNodeId === story.deathNodeId) return;

  state.currentNodeId = story.deathNodeId;
  state.path.push(story.deathNodeId);
  diffs.push({ kind: "node", target: story.deathNodeId, delta: 1 });
  events.push({ kind: "death_triggered", nodeId: story.deathNodeId });
}

export function resolveTerminal(state: PlayerState, story: Story): TerminalResult | null {
  const node = story.nodes[state.currentNodeId];
  if (!node?.endingId) return null;
  const ending = story.endings[node.endingId];
  if (!ending) return null;
  return { endingId: ending.id, kind: ending.kind };
}
