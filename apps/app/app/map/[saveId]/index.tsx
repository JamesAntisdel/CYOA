import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { EndingsMap, type EndingNode } from "../../../components/endings";
import { AppNav, BackToSceneButton } from "../../../components/navigation";
import { Text } from "../../../components/primitives";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import {
  getRemoteRunHistory,
  hasRemoteGameApi,
  type RemoteRunHistory,
  type RemoteRunHistoryTurn,
} from "../../../lib/gameApi";
import { useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";

/**
 * Storyboard card widths. The horizontal scroll affordance is the UX, so
 * the card width is intentionally narrower than the viewport on every
 * device — what changes is HOW narrow. On a 375px phone a 260px card
 * eats 70% of the viewport (one card visible at a time, no peek of the
 * next), so we shrink to 240px on phone to expose ~25% of the second
 * card and signal "this scrolls". Tablet+ keeps the wider card so two
 * cards land side-by-side on a typical 768px window.
 *
 * Drift guard: tests assert this constant exists rather than the bare
 * `width: 260` literal — see __tests__/storyboardCard.test.mjs.
 */
const STORYBOARD_CARD_WIDTH_PHONE = 240;
const STORYBOARD_CARD_WIDTH_DEFAULT = 260;

type FetchState =
  | { status: "loading" }
  | { status: "ready"; history: RemoteRunHistory }
  | { status: "empty" }
  | { status: "error"; message: string };

type MapView = "graph" | "storyboard";

// Cap each storyboard caption at ~160 chars and prefer to end on a
// sentence boundary so the visual emphasis stays on the image while the
// caption still reads as a coherent fragment. We never partially truncate
// mid-sentence with no punctuation — if no boundary lands inside the
// window, we append an ellipsis so the cut is visibly intentional.
const STORYBOARD_CAPTION_CHARS = 160;

function captionFromProse(prose: string): string {
  const trimmed = prose.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= STORYBOARD_CAPTION_CHARS) return trimmed;
  const window = trimmed.slice(0, STORYBOARD_CAPTION_CHARS);
  const lastBoundary = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (lastBoundary >= 60) {
    return window.slice(0, lastBoundary + 1);
  }
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace >= 60) {
    return `${window.slice(0, lastSpace)}…`;
  }
  return `${window}…`;
}

/**
 * Path-map view for a save.
 *
 * Previously a hardcoded stub. Now reads the same `getRemoteRunHistory`
 * the archive view uses and projects each visited turn → `EndingNode`.
 * Hidden-path discipline (spec callout in convex/safety): we never
 * surface authored node ids the reader hasn't reached and we don't try
 * to back-fill locked-but-not-visited hints from `state.flags`. The map
 * is a record of what the reader has done, not a sneak-peek at what
 * they might do next.
 *
 * Styling discipline: every color/spacing/typography value resolves
 * through `useAppTheme().tokens` — no inline hex codes or magic numbers.
 * The page now themes correctly in day, night, and sepia. The drift-
 * guard test in `components/reading/__tests__/themedPages.test.mjs`
 * enforces this.
 */
export default function SaveMapRoute() {
  const params = useLocalSearchParams<{ saveId?: string }>();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const saveId = typeof params.saveId === "string" ? params.saveId : "";
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [view, setView] = useState<MapView>("graph");

  useEffect(() => {
    if (!saveId) {
      setState({ status: "error", message: "Missing save id." });
      return;
    }
    if (!guest.session) return;
    if (!hasRemoteGameApi()) {
      setState({ status: "empty" });
      return;
    }

    let cancelled = false;
    void getRemoteRunHistory({
      accountId: guest.session.accountId,
      saveId,
      ...guestAuthArgs(),
    })
      .then((history) => {
        if (cancelled) return;
        if (!history) {
          setState({ status: "error", message: "Could not load the path map." });
          return;
        }
        setState({ status: "ready", history });
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Unknown error loading map.";
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [guest.session, saveId]);

  // Project visited turns → EndingNode rows. We use the reader's
  // CHOICE label (the action they took to reach this scene) as the
  // pathHint — that's what gives the map narrative texture without
  // leaking node ids. `unlocked` is always true because we only render
  // nodes the reader has actually visited; the EndingsMap component
  // still supports `unlocked: false` rows for the trophy/endings page
  // surface elsewhere, but the path-map view is "visited only".
  const visitedNodes: EndingNode[] =
    state.status === "ready"
      ? state.history.turns.map((turn) => ({
          id: `${turn.turnNumber}:${turn.nodeId}`,
          title: turn.sceneTitle,
          unlocked: true,
          ...(turn.choice?.choiceLabel
            ? { pathHint: turn.choice.choiceLabel }
            : {}),
        }))
      : [];

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      <AppNav current="library" />

      <View style={{ gap: tokens.spacing.sm }}>
        <Text
          style={{
            color: tokens.colors.textMuted,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "800",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          Path map
        </Text>
        <Text variant="title">
          {state.status === "ready" ? state.history.storyTitle : `Save ${saveId}`}
        </Text>
        <Text muted variant="bodySmall">
          Only visited nodes and earned endings are named.
        </Text>
        {/* Shared back affordance — see components/navigation/BackToSceneButton.
            Routes back to `/read/[saveId]` when there's no history (deep
            link). The drift-guard test asserts both this surface and
            /history import the same component. */}
        <BackToSceneButton fallbackHref={`/read/${saveId}`} />
      </View>

      {state.status === "loading" ? (
        <Text muted variant="bodySmall">
          Loading path…
        </Text>
      ) : null}
      {state.status === "error" ? (
        <Text muted variant="bodySmall">
          {state.message}
        </Text>
      ) : null}
      {state.status === "empty" ? (
        <Text muted variant="bodySmall">
          Path map is only available when connected to a remote save.
        </Text>
      ) : null}
      {state.status === "ready" && visitedNodes.length === 0 ? (
        <Text muted variant="bodySmall">
          No turns recorded yet — keep reading to fill in the map.
        </Text>
      ) : null}

      {visitedNodes.length > 0 ? (
        <>
          <ViewToggle current={view} onChange={setView} />
          {view === "graph" ? (
            <EndingsMap nodes={visitedNodes} />
          ) : (
            <Storyboard turns={state.status === "ready" ? state.history.turns : []} />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function ViewToggle({
  current,
  onChange,
}: {
  current: MapView;
  onChange: (next: MapView) => void;
}) {
  const { tokens } = useAppTheme();
  const options: { value: MapView; label: string }[] = [
    { value: "graph", label: "Graph" },
    { value: "storyboard", label: "Storyboard" },
  ];
  return (
    <View
      accessibilityLabel="Map view selector"
      style={{ flexDirection: "row", gap: tokens.spacing.sm }}
    >
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              backgroundColor: active
                ? tokens.colors.text
                : tokens.colors.surface,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.pill,
              borderWidth: tokens.borderWidths.hairline,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: tokens.spacing.md,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text
              style={{
                color: active ? tokens.colors.background : tokens.colors.text,
                fontWeight: "800",
              }}
              variant="bodySmall"
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Storyboard mode: each visited turn rendered as an image card with a
 * caption pulled from the first 1–2 sentences of the LLM-elaborated
 * prose. Past scenes without a ready Pro image surface as caption-only
 * cards so the visual flow doesn't break at gaps.
 */
function Storyboard({ turns }: { turns: RemoteRunHistoryTurn[] }) {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const cardWidth = isPhone
    ? STORYBOARD_CARD_WIDTH_PHONE
    : STORYBOARD_CARD_WIDTH_DEFAULT;
  return (
    <ScrollView
      horizontal
      accessibilityLabel="Storyboard strip"
      contentContainerStyle={{
        gap: tokens.spacing.md,
        paddingBottom: tokens.spacing.xs,
        paddingRight: tokens.spacing.lg,
      }}
      showsHorizontalScrollIndicator={false}
    >
      {turns.map((turn) => {
        const caption = captionFromProse(turn.prose);
        const imageUri = turn.media?.imageUri;
        return (
          <View
            key={turn.sceneId ?? `${turn.turnNumber}:${turn.nodeId}`}
            accessibilityLabel={`Turn ${turn.turnNumber} card`}
            style={{
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.hairline,
              overflow: "hidden",
              width: cardWidth,
            }}
          >
            {imageUri ? (
              <Image
                accessibilityLabel={`${turn.sceneTitle} illustration`}
                source={{ uri: imageUri }}
                style={{ aspectRatio: 16 / 9, width: "100%" }}
              />
            ) : (
              <View
                style={{
                  alignItems: "center",
                  aspectRatio: 16 / 9,
                  backgroundColor: tokens.colors.surfaceMuted,
                  justifyContent: "center",
                  width: "100%",
                }}
              >
                <Text
                  muted
                  style={{
                    fontFamily: tokens.typography.families.mono,
                    fontWeight: "700",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                  variant="caption"
                >
                  No illustration
                </Text>
              </View>
            )}
            <View
              style={{ gap: tokens.spacing.xs, padding: tokens.spacing.md }}
            >
              <Text
                muted
                style={{
                  fontFamily: tokens.typography.families.mono,
                  fontWeight: "800",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
                variant="caption"
              >
                {`Turn ${turn.turnNumber}`}
              </Text>
              <Text style={{ fontWeight: "800" }} variant="body">
                {turn.sceneTitle}
              </Text>
              {turn.choice?.choiceLabel ? (
                <Text
                  muted
                  style={{ fontStyle: "italic" }}
                  variant="caption"
                >
                  {`→ ${turn.choice.choiceLabel}`}
                </Text>
              ) : null}
              {caption ? <Text variant="bodySmall">{caption}</Text> : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
