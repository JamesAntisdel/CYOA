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
  return input.beats
    .slice()
    .sort((a, b) => b.turnNumber - a.turnNumber)
    .slice(0, max)
    .map((beat) => beat.text)
    .concat([input.currentSeed]);
}
