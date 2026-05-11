import type { ReaderHudMode } from "../shared";
import type { ReaderProjection } from "../../../hooks/useTurn";
import type { ChoiceProjection } from "../../../hooks/useTurn";

/**
 * Every reading layout consumes the same projection + streaming state and
 * differs only in typography, gutter, chrome, and media affordance. Layout
 * components do not own scene state — the reader pipeline upstream does.
 */
export type ReaderLayoutProps = {
  projection: ReaderProjection;
  streamedProse: string;
  isStreaming: boolean;
  pendingChoiceId: string | null;
  onChoose: (choice: ChoiceProjection) => void;
  hudMode: ReaderHudMode;
  reducedMotion: boolean;
  onOpenLibrary?: () => void;
  onOpenEndings?: () => void;
  onReturnHome?: () => void;
};

type Nav = (() => void) | undefined;

/**
 * Builds the EndingPanel prop bag from optional navigation callbacks. Required
 * because the panel's prop types live under `exactOptionalPropertyTypes:true`,
 * so we must omit keys whose value would otherwise be `undefined`.
 */
export function endingPanelHandlers(props: {
  onOpenEndings?: Nav;
  onOpenLibrary?: Nav;
  onReturnHome?: Nav;
}): {
  onOpenEndings?: () => void;
  onOpenLibrary?: () => void;
  onReturnHome?: () => void;
} {
  const handlers: {
    onOpenEndings?: () => void;
    onOpenLibrary?: () => void;
    onReturnHome?: () => void;
  } = {};
  if (props.onOpenEndings) handlers.onOpenEndings = props.onOpenEndings;
  if (props.onOpenLibrary) handlers.onOpenLibrary = props.onOpenLibrary;
  if (props.onReturnHome) handlers.onReturnHome = props.onReturnHome;
  return handlers;
}
