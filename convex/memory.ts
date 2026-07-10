export type MemoryBeat = {
  id: string;
  text: string;
  tags: string[];
  turnNumber: number;
};

export function buildMemoryWindow(input: {
  currentSeed: string;
  beats: MemoryBeat[];
  maxBeats?: number;
}): string[] {
  const max = input.maxBeats ?? 5;
  // Select the most-recent `max` beats (sort DESC, take the head), then emit
  // them oldest → newest so the narrator reads the window in chronological
  // order before the current seed. Returning them newest-first (the pre-fix
  // behaviour) made the model treat the earliest events as the latest
  // context — the exact continuity-collapse the memory window exists to fix.
  // Contract mirrored in game.ts loadMemoryWindow ("older turns sit at the
  // front of the window").
  return input.beats
    .slice()
    .sort((a, b) => b.turnNumber - a.turnNumber)
    .slice(0, max)
    .reverse()
    .map((beat) => beat.text)
    .concat([input.currentSeed]);
}
