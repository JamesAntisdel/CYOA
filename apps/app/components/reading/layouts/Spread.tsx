import { useCallback } from "react";
import { Animated, View, type StyleProp, type ViewStyle } from "react-native";

import type { ChoiceProjection } from "../../../hooks/useTurn";
import { SPREAD_MAX, SPREAD_MIN, useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Surface } from "../../primitives";
import { ConsequenceReel } from "../ConsequenceReel";
import { EffectBadge } from "../EffectBadge";
import { FallbackTurnPanel } from "../FallbackTurnPanel";
import { IlluminateButton } from "../IlluminateButton";
import { ProseRenderer } from "../ProseRenderer";
import { WhatMightHaveBeen } from "../WhatMightHaveBeen";
import { BookLayout } from "./Book";
import { NovelLayout } from "./Novel";
import { FootnoteChoices } from "./spread/FootnoteChoices";
import { Marginalia } from "./spread/Marginalia";
import { usePageTurnDriver } from "./spread/pageTurnAnim";
import {
  endingPanelHandlers,
  endingVariantProps,
  whatMightHaveBeenProps,
  type ReaderLayoutProps,
} from "./types";

/**
 * Spread — The Open Book, the desktop two-page layout (open-book R2 / R6 / R7,
 * OB1/OB4/OB7/OB8). A pure DROP-IN over the IDENTICAL {@link ReaderLayoutProps}:
 * the turn pipeline, `useTurn`, the engine, and convex see NOTHING new (OB1 /
 * R7.1). ReaderScreen dispatches `spread` here (it reads `readingMode` itself,
 * so a Novel save on the spread renders inside — its footnotes collapse to the
 * page-turn, OB8), while the reader chrome (top bar + ribbon) stays in the 760
 * column ABOVE this layout (OB4) — only the layout region widens.
 *
 * Structure (design §1/§3):
 *   desk ground (capped ≤ SPREAD_MAX 1400, centered — R2.2)
 *     VERSO (left)  — the scene illustration plate (SceneMedia) above the
 *                     marginalia rail (the declutter's own signals given room —
 *                     R3 / OB5). Degrades gracefully with no illustration: the
 *                     plate placeholder holds and the margin rises (R2.4).
 *     SPINE         — a paper gutter separating the two pages (R2.3).
 *     RECTO (right) — drop-cap prose (ProseRenderer `dropCap`) above the
 *                     numbered footnote choices (FootnoteChoices), which submit
 *                     through the UNCHANGED `onChoose` (R5.1). The turning page
 *                     binds the decorative `usePageTurnDriver` style; a committed
 *                     choice fires `animate()` AFTER submit — never gating the
 *                     turn (R6.3), a no-op under reduced-motion (R6.2).
 *
 * Below SPREAD_MIN (a reader who explicitly picked `spread` then narrowed) the
 * layout gracefully falls back to a single Book-like page — the linear Novel
 * page for a Novel save — never clipped/overlapping columns (R1.4 / R2.2).
 *
 * Terminal projection renders the EXISTING {@link EndingPanel} centered across
 * the spread — the ending/keepsake/share/ConsequenceReel logic is NOT forked
 * (OB7), mirroring `layouts/Mobile.tsx`.
 */
export function SpreadLayout(props: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const { width } = useBreakpoint();
  const pageTurn = usePageTurnDriver(props.reducedMotion);

  const {
    projection,
    streamedProse,
    isStreaming,
    pendingChoiceId,
    onChoose,
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
    onFreeformSubmit,
    freeformPending = false,
    freeformError = null,
    dialogBlocksEnabled = true,
    accountId,
    recentChoiceEcho = null,
    onRetryCurrentTurn,
    saveId,
    illuminateAuth,
  } = props;

  // Committed-choice handler (R6.3 / OB8): submit through the UNCHANGED
  // `onChoose` FIRST — the decorative page-turn NEVER blocks or delays the real
  // turn — then kick the curl purely for paint. Under reduced-motion `animate()`
  // is a no-op and the swap is instant (R6.2). In Novel mode FootnoteChoices
  // collapses to the single page-turn, which commits through this same handler,
  // so the page literally turns (OB8).
  const handleChoose = useCallback(
    (choice: ChoiceProjection) => {
      onChoose(choice);
      pageTurn.animate();
    },
    [onChoose, pageTurn],
  );

  // Single-page fallback below SPREAD_MIN (R1.4 / R2.2). All hooks above run
  // unconditionally, so this early return keeps hook order stable. Delegating to
  // the existing single-page layouts guarantees no clipped/overlapping columns
  // and preserves the Novel page-turn for a Novel save that narrowed.
  if (width < SPREAD_MIN) {
    return projection.readingMode === "novel" ? (
      <NovelLayout {...props} />
    ) : (
      <BookLayout {...props} />
    );
  }

  const isFallback = projection.scene.isFallback === true;

  return (
    <View style={{ alignSelf: "center", gap: tokens.spacing.lg, maxWidth: SPREAD_MAX, width: "100%" }}>
      {isFallback ? (
        // Deterministic-fallback: suppress the two pages, render only the retry
        // panel (identical discipline to Book/Mobile — the placeholder scene
        // must never reach the reader).
        <View style={{ alignSelf: "center", maxWidth: 760, width: "100%" }}>
          <FallbackTurnPanel
            onRetry={onRetryCurrentTurn ?? (() => undefined)}
            reducedMotion={reducedMotion}
          />
        </View>
      ) : projection.ending ? (
        // Terminal (OB7): the EXISTING EndingPanel, centered across the spread.
        // The ending/keepsake/share/reel logic is NOT forked — this mirrors
        // Mobile.tsx's terminal block exactly.
        <View style={{ alignSelf: "center", gap: tokens.spacing.lg, maxWidth: 760, width: "100%" }}>
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
        </View>
      ) : (
        <View style={{ flexDirection: "row", width: "100%" }}>
          {/* VERSO — the scene illustration plate + the marginalia rail. When no
              illustration is ready the plate holds a placeholder and the margin
              rises, so the verso is never an empty half-spread (R2.4). */}
          <Surface padded style={{ flex: 1, gap: tokens.spacing.md }}>
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
            <SceneCinematic
              media={projection.scene.media}
              reducedMotion={reducedMotion}
              videoEnabled={videoEnabled}
            />
            {saveId && illuminateAuth ? (
              <IlluminateButton saveId={saveId} auth={illuminateAuth} reducedMotion={reducedMotion} />
            ) : null}
            {/* The marginalia rail — the SINGLE mount of the declutter signals on
                the spread (OB5 / RC2). It self-hides when every signal is absent,
                letting the illustration take the whole page. NO new
                ReaderLayoutProps fields: every value is derived from the same
                projection the other layouts already consume (OB1). */}
            <Marginalia
              stats={projection.stats}
              inventory={projection.inventory}
              sceneId={projection.scene.id}
              saveId={saveId ?? projection.saveId}
              completedTurn={projection.turnNumber ?? 0}
              reducedMotion={reducedMotion}
              {...(projection.arc ? { arc: projection.arc } : {})}
              {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
              {...(projection.npcs ? { npcs: projection.npcs } : {})}
              {...(projection.codex ? { codex: projection.codex } : {})}
              {...(projection.turnNumber !== undefined ? { turnNumber: projection.turnNumber } : {})}
              {...(accountId ? { accountId } : {})}
              {...(illuminateAuth ? { auth: illuminateAuth } : {})}
              {...(projection.dailyId ? { dailyId: projection.dailyId } : {})}
            />
          </Surface>

          {/* SPINE — the paper gutter between the two facing pages (R2.3). */}
          <View
            style={{
              alignSelf: "stretch",
              backgroundColor: tokens.colors.borderMuted,
              marginHorizontal: tokens.spacing.md,
              width: tokens.borderWidths.heavy,
            }}
          />

          {/* RECTO — drop-cap prose + numbered footnotes. The whole page is the
              turning leaf: the decorative curl/opacity binds here (R6). */}
          {/* The driver's interpolated transform/opacity is a valid Animated
              style at runtime; the `readonly` shape of PageTurnDriver["style"]
              (owned by pageTurnAnim) just needs a cast to satisfy the static
              StyleProp element type. */}
          <Animated.View style={[{ flex: 1 }, pageTurn.style as unknown as StyleProp<ViewStyle>]}>
            <Surface padded style={{ flex: 1, gap: tokens.spacing.md }}>
              <ProseRenderer
                prose={streamedProse}
                isStreaming={isStreaming}
                dialogBlocksEnabled={dialogBlocksEnabled}
                dropCap
                textStyle={{ fontFamily: tokens.typography.families.serif }}
              />
              {/* Inline "what just changed" pill — between prose and footnotes. */}
              <EffectBadge entry={recentChoiceEcho} reducedMotion={reducedMotion} />
              {/* Footnote choices submit through the wrapped `handleChoose` so a
                  committed pick fires the decorative page-turn AFTER the real
                  submit (R6.3). Novel mode collapses to the single page-turn
                  (OB8) — driven by the SAME handler, so the page turns. */}
              <FootnoteChoices
                choices={projection.choices}
                onChoose={handleChoose}
                readingMode={projection.readingMode ?? null}
                pendingChoiceId={pendingChoiceId}
                isStreaming={isStreaming}
                reducedMotion={reducedMotion}
                disabled={isStreaming}
                {...(onFreeformSubmit ? { onFreeformSubmit } : {})}
                freeformPending={freeformPending}
                freeformError={freeformError}
              />
            </Surface>
          </Animated.View>
        </View>
      )}
    </View>
  );
}
