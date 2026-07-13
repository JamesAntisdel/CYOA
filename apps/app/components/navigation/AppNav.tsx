import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";

import { useAuthSession } from "../../hooks/useAuthSession";
import { brandAssets } from "../../lib/designAssets";
import { useBreakpoint } from "../../lib/responsive";
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

// The desktop tab row (brand wordmark + up to six fixed-cell pills) needs
// roughly this much width to lay out without the last pill ("Login") being
// clipped at the viewport edge. Below it we fall back to the hamburger drawer
// instead of a horizontally-scrolled row whose overflow reads as "cut off"
// rather than "swipe me". Above the shared phone breakpoint (520) but below
// this, tablets get the drawer too — a clean menu beats a clipped one.
const NAV_ROW_MIN_WIDTH = 900;

/**
 * Global top-nav shell.
 *
 * Two layouts:
 *
 *   - **Phone (< 520 px)**: brand mark on the left, **hamburger** icon on
 *     the right. Tapping the hamburger opens a full-screen drawer with
 *     every tab as a row. This pattern keeps the top of the screen
 *     uncluttered for reading and gives the menu enough room for clear
 *     labels + 44 px touch targets, instead of forcing a horizontal swipe
 *     that hid Settings/Account behind a non-obvious gesture.
 *   - **Tablet / desktop (≥ 520 px)**: original fixed-cell tab row on the
 *     right. Each cell holds `TAB_MIN_WIDTH` so labels of different
 *     lengths don't shift the row between routes.
 *
 * In both modes only fill + text color changes between active and
 * inactive states — no reflow on selection.
 */
export function AppNav({ current }: AppNavProps) {
  const router = useRouter();
  const auth = useAuthSession();
  const { tokens } = useAppTheme();
  const { isPhone, width } = useBreakpoint();
  // Use the hamburger drawer whenever the row can't fit, not only on phones —
  // this is what stops the "Login" pill being clipped on mid-width viewports.
  const useDrawer = isPhone || width < NAV_ROW_MIN_WIDTH;
  const items: readonly { key: AppNavTab; label: string; href: string }[] = auth.session
    ? NAV_ITEMS
    : [...NAV_ITEMS, LOGIN_ITEM];

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
            Wordmark hidden on phone to free up room for the hamburger
            and avoid wrapping the brand row. The glyph alone identifies
            the surface; tapping it still routes to /.
          */}
          {isPhone ? null : (
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              The Unwritten
            </Text>
          )}
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
            Tablet/desktop tab row. The wrapper view uses `flex: 1` +
            `minWidth: 0` so it can shrink below the natural row width on
            narrow tablet viewports and expose horizontal overflow on the
            inner ScrollView. Hamburger renders on phone, so this branch
            is never the visible one under 520 px.
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
