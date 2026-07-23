import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";

import { useAuthSession } from "../../hooks/useAuthSession";
import { brandAssets } from "../../lib/designAssets";
import { BREAKPOINTS, useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

/**
 * Valid tab keys for the top nav. `current` MUST be one of these
 * (or omitted when no tab is canonical for the route — e.g. the
 * landing page or the reader screen, which are intentionally
 * un-highlighted to avoid a misleading selection).
 *
 * Drift guard: changing this union also requires updating
 * `__tests__/appNav.test.mjs`, which pins the tab list and order.
 */
export type AppNavTab =
  | "library"
  | "discover"
  | "creator"
  | "account"
  | "settings"
  | "login";

type AppNavProps = {
  current?: AppNavTab;
};

/**
 * Authoritative tab list. Order is stable across every route — see
 * the drift-guard test for the reasoning. New tabs go at the end so
 * existing visual scanning paths aren't disturbed.
 */
const NAV_ITEMS: readonly { key: AppNavTab; label: string; href: string }[] = [
  { key: "library", label: "Library", href: "/library" },
  { key: "discover", label: "Discover", href: "/discover" },
  { key: "creator", label: "Create", href: "/creator" },
  { key: "account", label: "Account", href: "/account" },
  { key: "settings", label: "Settings", href: "/settings" },
] as const;

const LOGIN_ITEM = { key: "login" as const, label: "Login", href: "/login" };

// Each pill claims at least this much horizontal room so labels of
// different lengths ("Create" vs. "Settings") share the same visual
// cell on tablet/desktop. Active/inactive states never change padding
// or border width — only fill + text color — so the row never reflows
// on hover or route change.
const TAB_MIN_WIDTH = 96;

// Apple HIG says interactive targets should be ≥ 44 px on each axis;
// Material recommends 48. We pick 44 as the floor for both width and
// height so the tab pills are reliably tappable on phones.
const TAB_MIN_HEIGHT = 44;

// WORDMARK-visibility threshold ONLY (R7.3 / RC10). At or above this width the
// brand wordmark ("The Unwritten") renders beside the candle glyph; below it
// the glyph stands alone (as on phone) so the compact pill row has room. This
// is NO LONGER the pill-row-vs-hamburger gate — that decision is measured from
// the real tab count in `navRowNeededWidth` so 768–1023 gets the compact row,
// not the phone hamburger, on desktop-class widths.
const NAV_ROW_MIN_WIDTH = 1024;

// Estimated pixel width of the "The Unwritten" wordmark at subtitle / weight
// 800. Used only to keep the measured fit check honest once the wordmark is
// shown (≥ NAV_ROW_MIN_WIDTH); at those widths there is ample room, so the
// estimate need only be roughly right.
const WORDMARK_WIDTH = 150;

// Width of the candle brand glyph (see the <Image> below).
const BRAND_GLYPH_WIDTH = 32;

/**
 * Global top-nav shell.
 *
 * Three bands (R7.3 / RC10):
 *
 *   - **Below 768 px (phone + narrow tablet)**: brand glyph on the left,
 *     **hamburger** icon on the right. Tapping it opens a full-screen drawer
 *     with every tab as a row. This keeps the top uncluttered and gives the
 *     menu room for clear labels + 44 px touch targets instead of a
 *     horizontal swipe that hid Settings/Account behind a non-obvious gesture.
 *   - **768–1023 px (compact band)**: the fixed-cell pill row, WORDMARK
 *     HIDDEN (glyph only) so the pills fit without clipping — no phone
 *     hamburger on these desktop-class widths.
 *   - **≥ 1024 px (full desktop)**: the same pill row PLUS the "The
 *     Unwritten" wordmark beside the glyph.
 *
 * The pill-row-vs-hamburger choice is MEASURED from the live tab count
 * (`navRowNeededWidth`), not a fixed constant, so a width that genuinely
 * cannot fit the row still falls back to the drawer. Each cell holds
 * `TAB_MIN_WIDTH` so labels of different lengths don't shift the row between
 * routes, and only fill + text color changes between active and inactive
 * states — no reflow on selection.
 */
export function AppNav({ current }: AppNavProps) {
  const router = useRouter();
  const auth = useAuthSession();
  const { tokens } = useAppTheme();
  const { isPhone, width } = useBreakpoint();
  const items: readonly { key: AppNavTab; label: string; href: string }[] = auth.session
    ? NAV_ITEMS
    : [...NAV_ITEMS, LOGIN_ITEM];

  // The wordmark rides beside the glyph only from the desktop-class width
  // (≥ NAV_ROW_MIN_WIDTH). Below that the glyph alone identifies the surface,
  // exactly as on phone — this is the ONLY thing 1024 now gates (R7.3).
  const wordmarkVisible = !!width && width >= NAV_ROW_MIN_WIDTH;

  // Measure — don't assume (R7.3). Compute the width the compact pill row
  // actually needs from the live tab count and the real token gaps, so adding
  // or removing a tab (e.g. the logged-out "Login" pill) re-derives the
  // threshold instead of drifting from a hard-coded constant. Each pill claims
  // TAB_MIN_WIDTH; pills are separated by spacing.xs; the ScrollView adds a
  // spacing.xs pad on each side; the brand block (glyph, plus wordmark only
  // when visible) sits before the row separated by the container's spacing.md.
  const brandWidth =
    BRAND_GLYPH_WIDTH + (wordmarkVisible ? tokens.spacing.sm + WORDMARK_WIDTH : 0);
  const navRowNeededWidth =
    brandWidth +
    tokens.spacing.md +
    items.length * TAB_MIN_WIDTH +
    (items.length - 1) * tokens.spacing.xs +
    tokens.spacing.xs * 2;

  // Compact pill row from the ≥768 desktop breakpoint (RC10) WHEN it measures
  // as fitting; otherwise the hamburger drawer. A falsy/zero width (unreliable
  // through some webviews/tunnels) and any width where the row can't fit both
  // fall back to the drawer rather than rendering a clipped/scrolled row.
  const showPillRow =
    !isPhone && !!width && width >= BREAKPOINTS.tablet && width >= navRowNeededWidth;
  const useDrawer = !showPillRow;

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Cache horizontal offset for each tab so we can scroll the active
  // tab into view on tablet/desktop without measuring the DOM. Unused
  // on phone (the drawer renders the full list, no scroll needed).
  const scrollRef = useRef<ScrollView | null>(null);
  const activeIndex = current ? items.findIndex((item) => item.key === current) : -1;

  useEffect(() => {
    if (useDrawer) return;
    if (activeIndex < 0 || !scrollRef.current) return;
    const offset = activeIndex * (TAB_MIN_WIDTH + tokens.spacing.xs);
    scrollRef.current.scrollTo({ x: offset, animated: false });
  }, [activeIndex, useDrawer, tokens.spacing.xs]);

  const goTo = (href: string) => {
    setDrawerOpen(false);
    router.push(href);
  };

  return (
    <>
      <View
        accessibilityLabel="App navigation"
        style={{
          alignItems: "center",
          alignSelf: "stretch",
          flexDirection: "row",
          gap: tokens.spacing.md,
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="The Unwritten home"
          onPress={() => router.push("/")}
          style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}
        >
          <Image
            accessibilityLabel="The Unwritten candle mark"
            resizeMode="contain"
            source={brandAssets.glyphCandle}
            style={{ height: 32, width: 32 }}
          />
          {/*
            Wordmark hidden below NAV_ROW_MIN_WIDTH (phone AND the 768–1023
            compact band) to free up room for the pill row / hamburger and
            avoid wrapping the brand row. The glyph alone identifies the
            surface; tapping it still routes to /.
          */}
          {wordmarkVisible ? (
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              The Unwritten
            </Text>
          ) : null}
        </Pressable>

        {useDrawer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            accessibilityState={{ expanded: drawerOpen }}
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.md,
              borderWidth: tokens.borderWidths.hairline,
              justifyContent: "center",
              minHeight: TAB_MIN_HEIGHT,
              minWidth: TAB_MIN_HEIGHT,
              opacity: pressed ? 0.75 : 1,
              paddingHorizontal: tokens.spacing.sm,
            })}
          >
            <View style={{ gap: 4 }}>
              <View
                style={{
                  backgroundColor: tokens.colors.text,
                  borderRadius: 1,
                  height: 2,
                  width: 22,
                }}
              />
              <View
                style={{
                  backgroundColor: tokens.colors.text,
                  borderRadius: 1,
                  height: 2,
                  width: 22,
                }}
              />
              <View
                style={{
                  backgroundColor: tokens.colors.text,
                  borderRadius: 1,
                  height: 2,
                  width: 22,
                }}
              />
            </View>
          </Pressable>
        ) : (
          /*
            Compact/desktop pill row (shown from ≥768 when it measures as
            fitting — see showPillRow). The wrapper view uses `flex: 1` +
            `minWidth: 0` so it can shrink below the natural row width and
            expose horizontal overflow on the inner ScrollView as a safety
            net. The hamburger renders below 768 (and wherever the row can't
            fit), so this branch is never the clipped one.
          */
          <View style={{ flex: 1, minWidth: 0 }}>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityLabel="Main navigation"
              contentContainerStyle={{
                alignItems: "center",
                flexDirection: "row",
                gap: tokens.spacing.xs,
                justifyContent: "flex-end",
                paddingLeft: tokens.spacing.xs,
                paddingRight: tokens.spacing.xs,
              }}
            >
              {items.map((item) => {
                const active = current === item.key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    key={item.key}
                    onPress={() => router.push(item.href)}
                    // IMPORTANT: padding + border width MUST be identical
                    // for active and inactive states. Active only changes
                    // fill + text color — no reflow on selection.
                    style={({ pressed }) => ({
                      alignItems: "center",
                      backgroundColor: active ? tokens.colors.text : "transparent",
                      borderColor: active ? tokens.colors.text : tokens.colors.borderMuted,
                      borderRadius: tokens.radii.pill,
                      borderWidth: tokens.borderWidths.hairline,
                      justifyContent: "center",
                      minHeight: TAB_MIN_HEIGHT,
                      minWidth: TAB_MIN_WIDTH,
                      opacity: pressed ? 0.75 : 1,
                      paddingHorizontal: tokens.spacing.md,
                      paddingVertical: tokens.spacing.sm,
                    })}
                  >
                    <Text
                      style={{
                        color: active ? tokens.colors.background : tokens.colors.textMuted,
                        fontWeight: "800",
                        textAlign: "center",
                      }}
                      variant="bodySmall"
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/*
        Phone drawer. Mounted as a full-screen modal so it covers the
        reader/page below — keeps the menu unambiguous instead of a
        small dropdown that competes with on-screen content. Each tab
        is a 44+ px row with the same active/inactive treatment as the
        desktop pill (color swap only).
      */}
      <Modal
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
        transparent
        visible={drawerOpen}
      >
        <Pressable
          accessibilityLabel="Close navigation menu"
          onPress={() => setDrawerOpen(false)}
          style={{
            backgroundColor: "rgba(0,0,0,0.45)",
            flex: 1,
          }}
        >
          {/*
            Stop-press handler: tapping the menu surface itself must NOT
            close the drawer. Only the scrim around it closes. We use
            an inner Pressable with `onPress={() => undefined}` to claim
            the gesture before it bubbles up to the scrim Pressable.
          */}
          <Pressable
            accessibilityLabel="Navigation menu"
            onPress={() => undefined}
            style={{
              alignSelf: "stretch",
              backgroundColor: tokens.colors.background,
              borderBottomColor: tokens.colors.borderMuted,
              borderBottomWidth: tokens.borderWidths.hairline,
              gap: tokens.spacing.xs,
              padding: tokens.spacing.lg,
            }}
          >
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: tokens.spacing.sm,
                justifyContent: "space-between",
                marginBottom: tokens.spacing.sm,
              }}
            >
              <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
                <Image
                  accessibilityLabel="The Unwritten candle mark"
                  resizeMode="contain"
                  source={brandAssets.glyphCandle}
                  style={{ height: 28, width: 28 }}
                />
                <Text style={{ fontWeight: "800" }} variant="subtitle">
                  The Unwritten
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={() => setDrawerOpen(false)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: TAB_MIN_HEIGHT,
                  minWidth: TAB_MIN_HEIGHT,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ fontSize: 22, fontWeight: "800" }}>×</Text>
              </Pressable>
            </View>

            {items.map((item) => {
              const active = current === item.key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: active }}
                  key={item.key}
                  onPress={() => goTo(item.href)}
                  style={({ pressed }) => ({
                    alignItems: "flex-start",
                    backgroundColor: active ? tokens.colors.text : "transparent",
                    borderColor: active ? tokens.colors.text : tokens.colors.borderMuted,
                    borderRadius: tokens.radii.md,
                    borderWidth: tokens.borderWidths.hairline,
                    justifyContent: "center",
                    minHeight: TAB_MIN_HEIGHT,
                    opacity: pressed ? 0.75 : 1,
                    paddingHorizontal: tokens.spacing.md,
                    paddingVertical: tokens.spacing.sm,
                  })}
                >
                  <Text
                    style={{
                      color: active ? tokens.colors.background : tokens.colors.text,
                      fontWeight: "800",
                    }}
                    variant="body"
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
