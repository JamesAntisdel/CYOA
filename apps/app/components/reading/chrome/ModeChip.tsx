import { useState } from "react";
import { Modal, Pressable, View } from "react-native";

import {
  ModeMark,
  READING_MODE_META,
  type ReadingMode,
} from "../../../lib/readingMode";
import { useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";
import { Divider, Text } from "../../primitives";

/**
 * ModeChip — reading-modes cleanup (B2). The ONE always-present in-reader
 * indicator of content Axis 1 ("how this story reads"): a small chip showing
 * the CURRENT mode's mark + label (from the shared {@link READING_MODE_META},
 * never re-invented copy). It replaces the novel-only `<Stamp>Novel</Stamp>` so
 * BOTH modes read from a single indicator — a Branching save now says so too.
 *
 * Tapping the chip opens a small popover (bottom sheet on phone, anchored card
 * on desktop) that shows the current mode's blurb and a single switch action —
 * "Read as a Novel" / "Read as Branching" — wired to `onSwitch(other)`. The
 * parent (ReaderScreen) owns the server round-trip (`gameApi.setReadingMode`),
 * the Pro-gate routing, and the pending/confirmation state; this component is
 * presentational.
 *
 * The switch applies from the NEXT page — the current scene keeps its shape, so
 * on success the parent passes `confirmedMode` and the sheet surfaces a quiet
 * "takes effect on the next page" note instead of forcing the current layout to
 * flip.
 */
export type ModeChipProps = {
  /** The reader's CURRENT content mode (projection.readingMode, branching when absent). */
  mode: ReadingMode;
  /** Switch to the other mode — the parent performs the server call + gate routing. */
  onSwitch: (mode: ReadingMode) => void;
  /** True while a switch is in flight (server round-trip). */
  switchPending?: boolean;
  /** The mode a just-succeeded switch moved TO — surfaces the "next page" note. */
  confirmedMode?: ReadingMode | null;
  /**
   * Whether this save can actually round-trip a switch (SWITCH-UX #5). Local /
   * demo saves have no remote saves row, so `setReadingMode` no-ops — there the
   * chip is a LABEL-ONLY indicator (no dead switch button) that just states the
   * mode and that switching isn't available. Default true.
   */
  switchable?: boolean;
  /**
   * Controlled sheet visibility (SWITCH-UX #2). When the parent passes `open` +
   * `onOpenChange` it owns the popover's open state, so it can CLOSE the sheet
   * before routing to the paywall (otherwise the paywall renders UNDER the sheet
   * on native). Omit both to keep the chip self-managed.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Reader reduced-motion preference — kills the sheet slide/fade. */
  reducedMotion?: boolean;
};

const OTHER: Record<ReadingMode, ReadingMode> = {
  branching: "novel",
  novel: "branching",
};

export function ModeChip({
  mode,
  onSwitch,
  switchPending = false,
  confirmedMode = null,
  switchable = true,
  open: controlledOpen,
  onOpenChange,
  reducedMotion = false,
}: ModeChipProps) {
  const { tokens } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  // Controlled-or-uncontrolled open state. When the parent drives `open`, it
  // can close the sheet before a paywall push (SWITCH-UX #2); otherwise the
  // chip manages its own visibility.
  const [openInternal, setOpenInternal] = useState(false);
  const open = controlledOpen ?? openInternal;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOpenInternal(next);
    onOpenChange?.(next);
  };

  const meta = READING_MODE_META[mode];
  const target = OTHER[mode];
  const targetMeta = READING_MODE_META[target];
  // A switch has landed (server patched the save) but the current scene keeps
  // its shape — the new mode arrives with the next page. Show the note instead
  // of the switch button when the confirmed target is the OTHER mode.
  const confirmed = confirmedMode === target;

  return (
    <>
      {/* The always-present chip trigger. Left-aligned so it sits under the top
          bar without stretching — a quiet label, not a toolbar button. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          switchable
            ? `Reading mode: ${meta.label}. Tap to change how this story reads.`
            : `Reading mode: ${meta.label}.`
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          alignItems: "center",
          alignSelf: "flex-start",
          backgroundColor: tokens.colors.surfaceMuted,
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          flexDirection: "row",
          gap: tokens.spacing.xs,
          minHeight: 44,
          opacity: pressed ? 0.7 : 1,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <ModeMark mode={mode} size={16} />
        <Text style={{ fontWeight: "700" }} variant="caption">
          {meta.label}
        </Text>
        {/* Geometric affordance caret (not a control emoji — RC5). Dropped when
            the save can't switch — then the chip is a pure label, not a toggle. */}
        {switchable ? (
          <Text aria-hidden tone="faint" variant="caption">
            {"▾"}
          </Text>
        ) : null}
      </Pressable>

      <Modal
        animationType={reducedMotion ? "none" : isDesktop ? "fade" : "slide"}
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          accessibilityLabel="Close reading mode"
          onPress={() => setOpen(false)}
          style={{
            alignItems: isDesktop ? "flex-start" : "stretch",
            backgroundColor: tokens.colors.overlay,
            flex: 1,
            justifyContent: isDesktop ? "flex-start" : "flex-end",
            padding: isDesktop ? tokens.spacing.md : 0,
          }}
        >
          <Pressable
            accessibilityViewIsModal
            onPress={() => undefined}
            style={{
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.borderMuted,
              borderWidth: tokens.borderWidths.hairline,
              gap: tokens.spacing.md,
              padding: tokens.spacing.lg,
              ...(isDesktop
                ? { borderRadius: tokens.radii.md, maxWidth: 360, width: "100%" }
                : {
                    alignSelf: "stretch",
                    borderTopLeftRadius: tokens.radii.md,
                    borderTopRightRadius: tokens.radii.md,
                  }),
            }}
          >
            {/* Current mode — mark + label + the always-visible blurb, so the
                reader sees exactly what this axis means (the whole point of the
                cleanup) rather than decoding a bare toggle. */}
            <View
              style={{
                alignItems: "flex-start",
                flexDirection: "row",
                gap: tokens.spacing.md,
              }}
            >
              <View style={{ paddingTop: tokens.spacing.xs }}>
                <ModeMark mode={mode} size={22} />
              </View>
              <View style={{ flex: 1, gap: tokens.spacing.xs }}>
                <Text
                  style={{ fontFamily: tokens.typography.families.serif }}
                  variant="subtitle"
                >
                  {meta.label}
                </Text>
                <Text muted variant="bodySmall">
                  {meta.blurb}
                </Text>
              </View>
            </View>

            <Divider />

            {!switchable ? (
              // SWITCH-UX #5: no real remote saves row → the switch would no-op.
              // State the mode as a label and say switching isn't available
              // instead of offering a dead button.
              <Text muted variant="bodySmall">
                Mode switching isn&apos;t available for this tale.
              </Text>
            ) : confirmed ? (
              // Quiet confirmation — the switch landed; it applies from the next
              // page (the current scene keeps its shape, RC: no forced flip).
              <Text tone="accent" variant="bodySmall">
                {`${targetMeta.label} takes effect on the next page.`}
              </Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  target === "novel" ? "Read as a Novel" : "Read as Branching"
                }
                accessibilityState={{ disabled: switchPending }}
                disabled={switchPending}
                onPress={() => onSwitch(target)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: switchPending
                    ? tokens.colors.surfaceMuted
                    : tokens.colors.surface,
                  borderColor: tokens.colors.text,
                  borderRadius: tokens.radii.xs,
                  borderWidth: tokens.borderWidths.regular,
                  minHeight: 44,
                  justifyContent: "center",
                  opacity: pressed && !switchPending ? 0.85 : 1,
                  paddingVertical: tokens.spacing.md,
                })}
              >
                <Text style={{ fontWeight: "800" }} variant="body">
                  {switchPending
                    ? "Switching…"
                    : target === "novel"
                      ? "Read as a Novel"
                      : "Read as Branching"}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close reading mode"
              onPress={() => setOpen(false)}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text muted style={{ fontWeight: "800" }} variant="bodySmall">
                Close
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
