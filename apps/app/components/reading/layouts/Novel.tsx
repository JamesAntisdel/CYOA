import { useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, View } from "react-native";

import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { IlluminateButton } from "../IlluminateButton";
import { Divider, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { ConsequenceReel } from "../ConsequenceReel";
import { EffectBadge } from "../EffectBadge";
import { FallbackTurnPanel } from "../FallbackTurnPanel";
import { ProseRenderer } from "../ProseRenderer";
import { WhatMightHaveBeen } from "../WhatMightHaveBeen";
import type { ChoiceProjection } from "../../../hooks/useTurn";
import { canTurnPage, pageTurnLabel, resolvePageTurnChoice } from "./pageTurn";
import {
  endingPanelHandlers,
  endingVariantProps,
  whatMightHaveBeenProps,
  type ReaderLayoutProps,
} from "./types";

/**
 * Novel — reading-modes Wave 3 (R4). The TRUE linear read: chapter-length
 * prose ending in a single "Turn the page," no branching choices at all.
 *
 * This is NOT a sixth cosmetic skin (the five in `READER_LAYOUTS`). It is
 * selected by the CONTENT axis `projection.readingMode === "novel"` in
 * `ReaderScreen`'s dispatch, orthogonally to the cosmetic `layout` setting —
 * the AFFORDANCE changes, not the paint (design §4 Novel page-turn). It
 * consumes the IDENTICAL `ReaderLayoutProps` so the turn pipeline never forks,
 * and it swaps the ChoiceList button row for a page-turn affordance
 * (PageTurnAffordance) that submits the server-stamped `turn-page` choice
 * UNCHANGED through the same `onChoose` → `submitChoice` path (RM10 / R4.6 —
 * `useTurn` is untouched).
 *
 * Book-style typography (single generous serif column) is lifted from
 * `Book.tsx` — a linear read wants the book, not a panel or a card.
 */
export function NovelLayout({
  projection,
  streamedProse,
  isStreaming,
  pendingChoiceId,
  onChoose,
  hudMode,
  reducedMotion,
  onOpenEndings,
  onOpenLibrary,
  onReturnHome,
  onBeginAgain,
  onSeeMap,
  onShareEnding,
  onReadAsBook,
  onFork,
  choiceHistory,
  endingTier,
  cinematicUri,
  endingIsFirstFind,
  endingCinematic,
  muted = false,
  imagesEnabled = true,
  audioEnabled = true,
  videoEnabled = true,
  narratorPlaybackRate = 1,
  onNarratorPlaybackRateChange,
  onNarrationActiveChange,
  dialogBlocksEnabled = true,
  accountId,
  recentChoiceEcho = null,
  onRetryCurrentTurn,
  saveId,
  illuminateAuth,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const showHud = hudMode !== "hidden";
  // Deterministic-fallback branch: suppress the prose surface + affordance and
  // render `<FallbackTurnPanel />` (identical discipline to Book.tsx). The
  // deterministic placeholder must never reach the reader as a real chapter.
  const isFallback = projection.scene.isFallback === true;

  // The single server-stamped synthetic choice (`turn-page`). Read straight off
  // the projection so the id round-trips to `submitChoice` unchanged (R4.6).
  const pageTurnChoice = resolvePageTurnChoice<ChoiceProjection>(projection.choices);

  // First-scene explainer (B2). The novel-only mode badge is gone — the
  // persistent ModeChip in the reader chrome is now the SINGLE mode indicator
  // for BOTH modes. On the opening page we still greet a Novel reader with one
  // dismissable line: this read is linear by design + where to switch.
  const isFirstScene = (projection.turnNumber ?? 0) <= 0;
  const [explainerDismissed, setExplainerDismissed] = useState(() =>
    hasDismissedNovelExplainer(),
  );
  const showExplainer =
    isFirstScene && !explainerDismissed && !isFallback && !projection.ending;
  const dismissExplainer = () => {
    markNovelExplainerDismissed();
    setExplainerDismissed(true);
  };

  return (
    <View style={{ gap: tokens.spacing.lg, maxWidth: 760, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Text variant="title">{projection.storyTitle}</Text>
        <Text muted>{projection.scene.title}</Text>
      </View>

      {showExplainer ? (
        <NovelExplainer onDismiss={dismissExplainer} />
      ) : null}

      {isFallback ? (
        <FallbackTurnPanel
          onRetry={onRetryCurrentTurn ?? (() => undefined)}
          reducedMotion={reducedMotion}
        />
      ) : (
        <>
          <SceneMedia
            media={projection.scene.media}
            reducedMotion={reducedMotion}
            sceneId={projection.scene.id}
            imagesEnabled={imagesEnabled}
            audioEnabled={audioEnabled}
            narratorPlaybackRate={narratorPlaybackRate}
            {...(onNarratorPlaybackRateChange ? { onNarratorPlaybackRateChange } : {})}
            {...(onNarrationActiveChange ? { onNarrationActiveChange } : {})}
          />

          {saveId && illuminateAuth ? (
            <IlluminateButton saveId={saveId} auth={illuminateAuth} reducedMotion={reducedMotion} />
          ) : null}

          <Surface padded style={{ gap: tokens.spacing.lg }}>
            <ProseRenderer
              prose={streamedProse}
              isStreaming={isStreaming}
              dialogBlocksEnabled={dialogBlocksEnabled}
            />
            {showHud ? (
              <>
                <Divider />
                <StatsHud
                  inventory={projection.inventory}
                  // HUD reads mode from useReaderSettings itself
                  {...(projection.npcs ? { npcs: projection.npcs } : {})}
                  stats={projection.stats}
                  {...(accountId ? { accountId } : {})}
                  saveId={projection.saveId}
                  {...(projection.codex ? { codex: projection.codex } : {})}
                  {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
                  {...(projection.turnNumber !== undefined ? { turnNumber: projection.turnNumber } : {})}
                />
              </>
            ) : null}
          </Surface>

          <SceneCinematic
            media={projection.scene.media}
            reducedMotion={reducedMotion}
            videoEnabled={videoEnabled}
          />

          <EffectBadge entry={recentChoiceEcho} reducedMotion={reducedMotion} />

          {projection.ending ? (
            <>
              {endingCinematic ? (
                <CinematicMoment
                  cinematic={endingCinematic}
                  reducedMotion={reducedMotion}
                  muted={muted}
                  {...(projection.scene.media?.imageUri
                    ? { posterFallbackUri: projection.scene.media.imageUri }
                    : {})}
                />
              ) : null}
              <EndingPanel
                ending={projection.ending}
                {...endingVariantProps({
                  projection,
                  ...(endingTier !== undefined ? { tier: endingTier } : {}),
                  ...(cinematicUri !== undefined ? { cinematicUri } : {}),
                  ...(endingIsFirstFind !== undefined ? { isFirstFind: endingIsFirstFind } : {}),
                })}
                {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome, onBeginAgain, onSeeMap, onShareEnding, onReadAsBook })}
              />
              {choiceHistory && choiceHistory.length > 0 ? (
                <ConsequenceReel entries={choiceHistory} />
              ) : null}
              <WhatMightHaveBeen
                {...whatMightHaveBeenProps({ projection, onOpenEndings, onReturnHome, onFork, onBeginAgain })}
              />
            </>
          ) : (
            // The one contract-moving difference: a page-turn affordance
            // replaces the ChoiceList button row entirely (R4.6). No freeform
            // "Option D" in novel mode — the branch has collapsed to one path.
            <PageTurnAffordance
              choice={pageTurnChoice}
              isStreaming={isStreaming}
              pendingChoiceId={pendingChoiceId}
              reducedMotion={reducedMotion}
              onTurn={onChoose}
            />
          )}
        </>
      )}
    </View>
  );
}

type PageTurnAffordanceProps = {
  choice: ChoiceProjection | null;
  isStreaming: boolean;
  pendingChoiceId: string | null;
  reducedMotion: boolean;
  onTurn: (choice: ChoiceProjection) => void;
};

/**
 * The single "Turn the page" affordance — tap OR a leftward swipe. Both fire
 * the SAME handler, which submits the server-provided `turn-page` choice
 * unchanged (R4.6). It self-guards on the same facts the ChoiceList row it
 * replaces honors (streaming / pending / locked → non-submittable) via
 * `canTurnPage`; re-entrancy is ultimately safe because `submitChoice`
 * self-guards (RM10), but gating the affordance avoids a live-looking dead tap.
 */
function PageTurnAffordance({
  choice,
  isStreaming,
  pendingChoiceId,
  reducedMotion,
  onTurn,
}: PageTurnAffordanceProps) {
  const { tokens } = useAppTheme();
  const active = canTurnPage({ choice, isStreaming, pendingChoiceId });
  const isPending = Boolean(choice) && pendingChoiceId === choice?.id;
  const label = pageTurnLabel(choice);

  const nudge = useRef(new Animated.Value(0)).current;

  const fireTurn = () => {
    if (!active || !choice) return;
    onTurn(choice);
  };

  // A leftward drag past the threshold turns the page (mirrors flipping a
  // physical leaf forward). Taps still pass through to the inner Pressable —
  // the pan only claims the gesture once it reads as a deliberate horizontal
  // swipe, so scrolls and taps are unaffected.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          active && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_evt, gesture) => {
          if (reducedMotion) return;
          nudge.setValue(Math.max(-24, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: (_evt, gesture) => {
          const swiped = gesture.dx <= -48;
          Animated.timing(nudge, {
            toValue: 0,
            duration: reducedMotion ? 0 : 160,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
          if (swiped) fireTurn();
        },
        onPanResponderTerminate: () => {
          nudge.setValue(0);
        },
      }),
    // `active`/`choice` are read through closure at gesture time via fireTurn;
    // rebuild only when interactivity flips so a settled scene keeps one responder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, reducedMotion],
  );

  // The 0-choice terminal payload (novel schema permits .min(0)) yields no
  // choice; the ending branch above already owns that case, but guard here too
  // so a stray non-terminal 0-choice scene renders nothing rather than a dead
  // button.
  if (!choice) return null;

  return (
    <Animated.View
      accessibilityLabel="Turn the page"
      style={{ transform: [{ translateX: nudge }] }}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !active }}
        disabled={!active}
        onPress={fireTurn}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: active ? tokens.colors.surface : tokens.colors.surfaceMuted,
          borderColor: tokens.colors.text,
          borderRadius: tokens.radii.xs,
          borderWidth: tokens.borderWidths.heavy,
          opacity: pressed && active ? 0.85 : 1,
          paddingVertical: tokens.spacing.lg,
        })}
      >
        <Text
          variant="subtitle"
          style={{ fontFamily: tokens.typography.families.serif }}
        >
          {isPending ? "Turning…" : label}
        </Text>
        <Text muted variant="caption">
          Swipe or tap to read on
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * First-scene explainer (B2). One quiet line orienting a Novel reader: this
 * tale is linear by design, and the mode chip in the reader chrome is where to
 * switch back to Branching. Dismissable; the dismissal persists so it greets
 * the reader once, not every session.
 */
function NovelExplainer({ onDismiss }: { onDismiss: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <Surface
      padded
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.md,
      }}
    >
      <Text muted style={{ flex: 1 }} variant="bodySmall">
        This tale reads like a novel — one continuous story, no choices. Change
        it anytime from the reading-mode chip above.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={({ pressed }) => ({
          alignItems: "center",
          justifyContent: "center",
          minHeight: 44,
          minWidth: 44,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontWeight: "800" }} tone="accent" variant="bodySmall">
          Got it
        </Text>
      </Pressable>
    </Surface>
  );
}

const NOVEL_EXPLAINER_KEY = "cyoa.novelExplainerDismissed.v1";

function novelExplainerStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

/** True once the reader has dismissed the first-scene Novel explainer. */
function hasDismissedNovelExplainer(): boolean {
  try {
    return novelExplainerStorage()?.getItem(NOVEL_EXPLAINER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the dismissal so the explainer greets the reader only once. */
function markNovelExplainerDismissed(): void {
  try {
    novelExplainerStorage()?.setItem(NOVEL_EXPLAINER_KEY, "1");
  } catch {
    /* ignore — a private-mode reader just sees it again next session */
  }
}
