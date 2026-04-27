export function assertNonEmptyId(id: string, label: string): string {
  if (id.trim().length === 0) {
    throw new Error(`${label}_required`);
  }
  return id;
}

export function makeDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
