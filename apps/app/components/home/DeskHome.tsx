import { View } from "react-native";

import { AppNav } from "../navigation";
import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { RemoteDailyToday } from "../../lib/dailyApi";
import type { RemoteDailyTurnState } from "../../lib/dailyTurnApi";
import type { RemoteLibrarianRank } from "../../lib/gameApi";
import {
  librarianRankChipLabel,
  librarianRankProgressLine,
} from "../../lib/storyEngagementW3";
import { Candle } from "./desk/Candle";
import { Door } from "./desk/Door";
import { KeyRing } from "./desk/KeyRing";
import { Letter } from "./desk/Letter";
import { OpenTome, type ContinueSaveInfo } from "./desk/OpenTome";
import { Shelf } from "./desk/Shelf";
import { StartHere } from "./desk/StartHere";

/**
 * DeskHome — the diegetic "writer's desk" home (the-desk Wave 2, task 2.2 —
 * R2.1/R4/R5/R7, design §2/§3, DK1/DK6/DK7/DK8).
 *
 * The desk GROUND is a single themed Surface holding the diegetic OBJECTS the
 * DK-OBJECTS wave built (each a real labeled 44px button over `DeskObject`).
 * Per the §3 mock the desk is a three-column arrangement:
 *   - left   — the Shelf (library) + the KeyRing (trophies);
 *   - centre — the open tome (continue) OR, when there is no in-progress save,
 *              StartHere as the PRIMARY, most-prominent object (R4.2/DK6); the
 *              rank/progress read sits under it (DK6);
 *   - right  — the Candle (turn budget), the Letter (Daily, self-hides), and
 *              the Door (discover).
 *
 * HARD rules honored here:
 *  - DK4 — data is PROPS ONLY. Every value below is already computed by
 *    `app/index.tsx`; DeskHome introduces NO hooks/queries.
 *  - DK6 — the mandatory funnel objects ALL render: continue (tome) + StartHere
 *    (tutorial), Daily (letter), library (shelf), the rank/progress read, and
 *    the guest soft-signup path (the AppNav "Login" pill, exactly as the card
 *    home surfaces it). Both the tome AND StartHere are always in the tree so
 *    the funnel is intact whether or not there is a save.
 *  - DK8 — reduced-motion: the desk is STILL. There is no ambient motion here
 *    (DeskObject renders none either); the `reducedMotion` prop gates any future
 *    ambient flourish, so a reduced-motion reader gets an identical, usable desk.
 *  - Art-light (R3.1) — objects are built from existing covers/glyphs/tokens;
 *    DeskHome adds only themed `View`/`Surface` structure. No new assets.
 *
 * DeskHome is rendered ONLY behind the R1 gate at >=768 (DK1/DK7); the phone /
 * flag-off / no-session fallback stays the byte-identical card home in
 * `app/index.tsx`.
 */

// Mirrors the Letter's (and DailyCard's) start-result union so the Daily
// routing lines up without re-typing at the call site.
type DailyStartResult =
  | { ok: true; saveId: string }
  | { ok: false; errorCode: string; errorMessage: string }
  | null;

export type DeskHomeProps = {
  /** The reader's in-progress save (tome open) or null (tome closed — R2.3). */
  continueSave: ContinueSaveInfo | null;
  /** Today's Daily, or null when there's no row today (the letter self-hides). */
  dailyToday: RemoteDailyToday | null;
  /** Story ids whose covers become the shelf spines (starter/library — DK4). */
  starterStoryIds: string[];
  /** The reader's librarian rank/progress (the mandatory rank read — DK6). */
  librarianRank?: RemoteLibrarianRank | null;
  /** The tutorial story title for StartHere (or null → "Start Tutorial"). */
  tutorialTitle: string | null;
  /**
   * Optional live daily turn-state (from the EXISTING getRemoteDailyTurnState —
   * a reused call, not a new query). Omitted => the Candle shows a static
   * full-candle budget cue (DK4).
   */
  turnState?: RemoteDailyTurnState | null;
  /** Reduced-motion (system OR reader setting): gates any ambient flourish (DK8). */
  reducedMotion: boolean;
  /** Open the reader at a save (tome / Daily fresh-start). */
  onOpenSave: (saveId: string) => void;
  /** Start today's Daily (the same wrapper app/index.tsx feeds DailyCard). */
  onStartDaily: () => Promise<DailyStartResult>;
  /** Route to the Daily results screen (played / already-played). */
  onOpenDailyResults: (dailyId: string) => void;
  /** Launch the tutorial save (StartHere → the existing launchTutorial). */
  onLaunchTutorial: () => void;
  /** Navigate to /library (the shelf). */
  onNavLibrary: () => void;
  /** Navigate to /endings (the key ring). */
  onNavEndings: () => void;
  /** Navigate to /discover (the door). */
  onNavDiscover: () => void;
  /** Navigate to /paywall (the candle → the patronage/limit surface). */
  onNavPaywall: () => void;
};

// The desk only ever renders >=768 (DK7), so a fixed 3-column row is safe — the
// mock's left / centre / right arrangement. The centre is given the most room.
const COL_LEFT_FLEX = 1;
const COL_CENTRE_FLEX = 1.3;
const COL_RIGHT_FLEX = 1;

export function DeskHome({
  continueSave,
  dailyToday,
  starterStoryIds,
  librarianRank,
  tutorialTitle,
  turnState,
  // reducedMotion is accepted to honor the design signature (DK8): the desk is
  // deliberately still, so there is nothing to gate today, but keeping the prop
  // means a future ambient flourish (candle flicker) has its switch in place
  // without re-plumbing the call site.
  reducedMotion: _reducedMotion,
  onOpenSave,
  onStartDaily,
  onOpenDailyResults,
  onLaunchTutorial,
  onNavLibrary,
  onNavEndings,
  onNavDiscover,
  onNavPaywall,
}: DeskHomeProps) {
  const { tokens } = useAppTheme();
  const hasSave = Boolean(continueSave);

  return (
    <View
      style={{
        backgroundColor: tokens.colors.background,
        flex: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      {/* The AppNav carries the guest soft-signup path (the "Login" pill) plus
          library/discover/account — the SAME nav the card home renders, so the
          soft-signup funnel object is present on the desk (DK6). */}
      <AppNav />

      {/* The desk ground — a single themed Surface (radial-lit in the mock;
          here a bounded muted panel) holding the objects in three columns. */}
      <View
        style={{
          alignSelf: "center",
          backgroundColor: tokens.colors.surfaceMuted,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.md,
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.lg,
          maxWidth: 1120,
          padding: tokens.spacing.lg,
          width: "100%",
        }}
      >
        {/* Left column — library + trophies. */}
        <View style={{ flex: COL_LEFT_FLEX, gap: tokens.spacing.lg }}>
          <Shelf onPress={onNavLibrary} storyIds={starterStoryIds} />
          <KeyRing onPress={onNavEndings} />
        </View>

        {/* Centre column — the primary. With a save the open tome leads and
            StartHere is demoted; with no save StartHere is the bright primary
            (R4.2/DK6) and the tome sits quiet/closed beside it. BOTH always
            render so the funnel is intact either way (DK6). The rank/progress
            read sits under the centre object (DK6). */}
        <View style={{ flex: COL_CENTRE_FLEX, gap: tokens.spacing.lg }}>
          {hasSave ? (
            <>
              <OpenTome continueSave={continueSave} onOpenSave={onOpenSave} />
              <StartHere
                onPress={onLaunchTutorial}
                primary={false}
                tutorialTitle={tutorialTitle}
              />
            </>
          ) : (
            <>
              <StartHere
                onPress={onLaunchTutorial}
                primary
                tutorialTitle={tutorialTitle}
              />
              <OpenTome continueSave={null} onOpenSave={onOpenSave} />
            </>
          )}

          {librarianRank ? (
            // The mandatory rank/progress read (DK6). The a11y label names the
            // rank in plain words (matching the card home's continue-lead) so a
            // screen-reader reader hears the rank; the visible line is the
            // progress copy only.
            <Text
              accessibilityLabel={`Librarian rank: ${librarianRankChipLabel(librarianRank)}. ${librarianRankProgressLine(librarianRank)}.`}
              muted
              style={{ textAlign: "center" }}
              variant="caption"
            >
              {librarianRankProgressLine(librarianRank)}
            </Text>
          ) : null}
        </View>

        {/* Right column — turn budget, the Daily letter (self-hides when there
            is no daily today — R2.3), and the door to discovery. */}
        <View style={{ flex: COL_RIGHT_FLEX, gap: tokens.spacing.lg }}>
          <Candle
            onPress={onNavPaywall}
            {...(turnState !== undefined ? { turnState } : {})}
          />
          <Letter
            daily={dailyToday}
            onOpenReader={onOpenSave}
            onOpenResults={onOpenDailyResults}
            onStart={onStartDaily}
          />
          <Door onPress={onNavDiscover} />
        </View>
      </View>
    </View>
  );
}
