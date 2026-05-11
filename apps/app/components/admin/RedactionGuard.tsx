import { PropsWithChildren, ReactNode } from "react";

import { Text } from "../primitives";

export type RedactionKind = "prose" | "pii" | "safe";

const PROSE_PLACEHOLDER = "Prose withheld from the keeper's desk";
const PII_PLACEHOLDER = "Identifier withheld from the keeper's desk";

/**
 * Returns true when a value's kind is one that may never surface raw
 * on an operator dashboard. The two redacted kinds correspond to the
 * canvas spec for § 25: no raw prose, no personal data.
 */
export function isRedactedKind(kind: RedactionKind): boolean {
  return kind === "prose" || kind === "pii";
}

/**
 * Replaces a raw value with a neutral, book-voice placeholder when its
 * kind is unsafe to render. Used as the source of truth for both the
 * `RedactionGuard` component and any plain-string call sites (e.g. when
 * we need a redacted label rather than a node).
 */
export function redactValue<T>(kind: RedactionKind, value: T): T | string {
  if (kind === "prose") return PROSE_PLACEHOLDER;
  if (kind === "pii") return PII_PLACEHOLDER;
  return value;
}

export const redactionPlaceholders = {
  prose: PROSE_PLACEHOLDER,
  pii: PII_PLACEHOLDER,
} as const;

type RedactionGuardProps = PropsWithChildren<{
  kind: RedactionKind;
  /**
   * Optional override for the placeholder node rendered when `kind`
   * is unsafe. Defaults to a muted caption with the canonical copy.
   */
  fallback?: ReactNode;
}>;

/**
 * Wraps any metric tile, cell, or string that *might* contain raw prose
 * or personally identifying data. If `kind` is "prose" or "pii" the
 * children are dropped and replaced with a neutral, book-voice
 * placeholder — guaranteeing the operator surface never leaks the
 * underlying value, even when the data source is wrong.
 *
 * Safety + Live boards use this around any field whose shape includes
 * categories, actions, story ids, account ids, or save ids.
 */
export function RedactionGuard({ children, fallback, kind }: RedactionGuardProps) {
  if (kind === "safe") {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <Text muted variant="caption">
      {redactionPlaceholders[kind]}
    </Text>
  );
}
