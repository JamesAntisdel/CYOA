import { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";

import { useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";
import { Divider, Icon, type IconName, Stamp, Text } from "../../primitives";

/**
 * One Tome-menu row (design §1). This is the CANONICAL shape both the pure
 * builder (RC-BAR's `tomeRows.ts`, which should `import type { TomeRow }` from
 * here) and RC-WIRE render against — one definition, no drift.
 *
 *   - `selected` present ⇒ a toggle row (Auto-read): renders an on/off state.
 *   - `quiet`    ⇒ rendered below a divider in muted type (the AI-flag action
 *                  + "Leave the tale", per the §3 mock).
 * The AI DISCLOSURE itself never lives here — only the flag ACTION does; the
 * persistent "AI-generated tale" caption stays a page footer (U3 / R2.5).
 */
export type TomeRow = {
  key: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  selected?: boolean;
  quiet?: boolean;
};

export type TomeSheetProps = {
  open: boolean;
  onClose: () => void;
  rows: TomeRow[];
  /** Reader's reduced-motion preference — kills the slide/fade (R2.3 instant). */
  reducedMotion?: boolean;
};

const WEB = Platform.OS === "web";

/** DOM focusables inside the sheet (web only) — for the focus trap (U5). */
function focusablesIn(node: HTMLElement | null): HTMLElement[] {
  if (!node) return [];
  const sel =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(node.querySelectorAll<HTMLElement>(sel));
}

/**
 * TomeSheet (R2 / RC10) — the single bottom sheet (phone, <768) / anchored
 * popover (desktop, ≥768, max-width ≈400 near the top-right Tome trigger) that
 * holds everything auxiliary about *this tale*. Presentational: it renders the
 * `TomeRow[]` the caller builds and owns no data.
 *
 * Closes on backdrop tap, on an explicit "Close" affordance, on a row action
 * that navigates, and — on web — on Escape. Reduced motion drops the animation.
 * On web it traps Tab focus while open and restores focus to the trigger on
 * close (R2.3 / U5).
 */
export function TomeSheet({ open, onClose, rows, reducedMotion = false }: TomeSheetProps) {
  const { tokens } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const sheetRef = useRef<View>(null);
  // The element focused when the sheet opened (the trigger) — restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);
  // Held in a ref so the focus-trap effect depends only on `open`: ReaderScreen
  // passes an inline arrow, and depending on it would tear down/re-run the
  // effect on every background re-render (streaming ticks, candle clock) —
  // each teardown restores focus to the trigger BEHIND the open modal, then
  // the re-run yanks it back to the sheet's first focusable.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!WEB || !open) return;
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return;
    restoreRef.current = doc.activeElement as HTMLElement | null;

    const node = sheetRef.current as unknown as HTMLElement | null;
    // Move focus into the sheet so keyboard users land inside it.
    focusablesIn(node)[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: cycle within the sheet's focusables.
      const items = focusablesIn(sheetRef.current as unknown as HTMLElement | null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    doc.addEventListener("keydown", onKey, true);
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      // Restore focus to the trigger (U5).
      const toRestore = restoreRef.current;
      if (toRestore && typeof toRestore.focus === "function") toRestore.focus();
    };
  }, [open]);

  return (
    <Modal
      animationType={reducedMotion ? "none" : isDesktop ? "fade" : "slide"}
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <Pressable
        accessibilityLabel="Close the Tome"
        onPress={onClose}
        style={{
          backgroundColor: tokens.colors.overlay,
          flex: 1,
          // Phone: anchor the sheet to the bottom. Desktop: anchor the popover
          // to the top-right, under the Tome trigger (RC10 / R7.4).
          alignItems: isDesktop ? "flex-end" : "stretch",
          justifyContent: isDesktop ? "flex-start" : "flex-end",
          padding: isDesktop ? tokens.spacing.md : 0,
        }}
      >
        <Pressable
          accessibilityLabel="The Tome"
          accessibilityViewIsModal
          onPress={() => undefined}
          ref={sheetRef}
          style={{
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.borderMuted,
            borderWidth: tokens.borderWidths.hairline,
            ...(isDesktop
              ? {
                  borderRadius: tokens.radii.md,
                  maxWidth: 400,
                  width: "100%",
                }
              : {
                  alignSelf: "stretch",
                  borderTopLeftRadius: tokens.radii.md,
                  borderTopRightRadius: tokens.radii.md,
                  maxHeight: "75%",
                }),
          }}
        >
          <View
            style={{
              alignItems: "center",
              borderBottomColor: tokens.colors.borderMuted,
              borderBottomWidth: tokens.borderWidths.hairline,
              flexDirection: "row",
              gap: tokens.spacing.sm,
              justifyContent: "space-between",
              paddingHorizontal: tokens.spacing.lg,
              paddingVertical: tokens.spacing.md,
            }}
          >
            <Stamp>The Tome</Stamp>
            <Pressable
              accessibilityLabel="Close the Tome"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                minWidth: 44,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text muted style={{ fontWeight: "800" }} variant="bodySmall">
                Close
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingVertical: tokens.spacing.xs }}>
            {rows.map((row, index) => {
              const prev = rows[index - 1];
              const dividerBefore = Boolean(row.quiet) && !prev?.quiet;
              return (
                <View key={row.key}>
                  {dividerBefore ? <Divider style={{ marginVertical: tokens.spacing.xs }} /> : null}
                  <TomeSheetRow onClose={onClose} row={row} />
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TomeSheetRow({ row, onClose }: { row: TomeRow; onClose: () => void }) {
  const { tokens } = useAppTheme();
  const stateLabel = row.selected === undefined ? undefined : row.selected ? "on" : "off";
  const a11y =
    stateLabel === undefined ? row.label : `${row.label}, ${stateLabel}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      {...(row.selected !== undefined ? { accessibilityState: { selected: row.selected } } : {})}
      onPress={() => {
        row.onPress();
        // A row action that navigates closes the sheet (R2.3); a toggle row
        // (Auto-read) stays open so the reader sees the on/off state flip.
        if (row.selected === undefined) onClose();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.sm,
        minHeight: 44,
        opacity: pressed ? 0.7 : 1,
        paddingHorizontal: tokens.spacing.lg,
        paddingVertical: tokens.spacing.sm,
      })}
    >
      {row.icon ? <Icon name={row.icon} size={16} color={tokens.colors.accent} /> : null}
      <Text
        muted={row.quiet === true}
        style={{ flex: 1 }}
        variant={row.quiet ? "bodySmall" : "body"}
      >
        {row.label}
      </Text>
      {stateLabel ? (
        <Text tone="faint" variant="caption">
          {stateLabel}
        </Text>
      ) : null}
      {/* Geometric affordance chevron (not a control emoji — RC5). */}
      <Text aria-hidden tone="faint" variant="caption">
        {"▸"}
      </Text>
    </Pressable>
  );
}
