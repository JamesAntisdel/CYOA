/**
 * Client-side prettifiers for trophy-crypt labels (core-read-loop Req 8 /
 * panel-review fix). Server rows for LLM-driven endings historically carry
 * only machine identifiers — kebab-case ending slugs ("grim-harvest") and
 * synthetic node ids of the form `<storyId>:llm:<N>` in the recorded path.
 * A server-side label persistence lands separately; until then (and as a
 * permanent fallback for legacy rows) these helpers keep raw machine ids off
 * the trophy shelf.
 *
 * Pure module — safe for `node --test` / vitest without the RN runtime.
 */

/**
 * Synthetic LLM node/ending ids: `<storyId>:llm:<N>` (e.g.
 * "open-canvas:llm:7"). These carry no human meaning and must never render.
 */
const MACHINE_ID = /^.+:llm:\d+$/;

export function isMachineId(id: string): boolean {
  return MACHINE_ID.test(id);
}

/** "grim-harvest" / "grim_harvest" → "Grim Harvest". */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Human title for an unlocked ending. Order of preference:
 *   1. a server-persisted `label` when present (future rows),
 *   2. a title-cased slug when the endingId is a readable slug,
 *   3. a generic fallback when the endingId is a machine id.
 */
export function prettifyEndingLabel(
  endingId: string,
  label?: string | null | undefined,
): string {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  if (isMachineId(endingId)) return "An unnamed ending";
  // Namespaced-but-readable ids ("bone-cathedral:last-rite") keep only the
  // final, human segment.
  const slug = endingId.split(":").pop() ?? endingId;
  return titleCaseSlug(slug);
}

/**
 * Human path hint from the recorded node-id path. Machine segments
 * (`storyId:llm:N`) are dropped entirely; readable slugs are title-cased and
 * joined with the crypt's arrow separator. Returns undefined when nothing
 * human remains, so callers can omit the hint via conditional spread (BC4).
 */
export function prettifyPathHint(path: string[] | undefined): string | undefined {
  if (!path || path.length === 0) return undefined;
  const readable = path
    .filter((segment) => !isMachineId(segment))
    .map((segment) => titleCaseSlug(segment.split(":").pop() ?? segment))
    .filter((segment) => segment.length > 0);
  if (readable.length === 0) return undefined;
  return readable.join(" → ");
}

/**
 * Path hint for an unlock row. Order of preference:
 *   1. server-persisted choice labels (`pathLabels`, oldest→newest) — already
 *      human, so they join directly,
 *   2. the prettified node-id `path` for legacy rows (see prettifyPathHint).
 * Returns undefined when neither yields anything human, so callers can omit
 * the hint via conditional spread.
 */
export function preferredPathHint(
  pathLabels: string[] | undefined,
  path: string[] | undefined,
): string | undefined {
  const labels = (pathLabels ?? [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  if (labels.length > 0) return labels.join(" → ");
  return prettifyPathHint(path);
}
