import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, View } from "react-native";

import { Button, Text } from "../primitives";
import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import {
  alightCopy,
  balanceCopy,
  candleGlyph,
  candleIsTappable,
  candleLabel,
  canAffordIllumination,
  getRemoteIlluminationState,
  illuminateCandleMode,
  illuminationCost,
  requestRemoteIllumination,
  type IlluminationKind,
  type RemoteIlluminationState,
} from "../../lib/illuminateApi";

type IlluminateAuth = { accountId: string; guestTokenHash?: string };

type IlluminateButtonProps = {
  /** The save whose CURRENT page the candle lights. */
  saveId: string;
  /** Reader session auth. Absent (local/demo saves) → the button renders nothing. */
  auth?: IlluminateAuth | undefined;
  /** Which cosmetic to attach. Defaults to a still ("light the page"). */
  kind?: IlluminationKind;
  /** Honor prefers-reduced-motion — the candle never pulses when true. */
  reducedMotion?: boolean;
};

// While an illumination is kindling we re-read the state on a gentle cadence so
// the candle advances queued → generating → illuminated without the reader
// doing anything. Cheap: one small query, and only while in-flight.
const POLL_MS = 2500;

/**
 * IlluminateButton — the reader-facing candle affordance (Iris proposal,
 * product-readiness review 2026-07-12). A gilt candle sits on the resolved
 * scene; tapping opens a fiction-styled sheet that shows the page's existing
 * still (the ALWAYS-FREE preview) and offers to "set this page alight" for a
 * spark cost, against the reader's current balance. Confirming attaches cosmetic
 * media to the already-resolved page — it NEVER gates the read (principle 7).
 *
 * The candle self-hides on any page that can't be illuminated (unresolved prose,
 * local/demo save, no session), so reading is never interrupted. When media is
 * already attached it reads "illuminated" and no-ops.
 */
export function IlluminateButton({
  saveId,
  auth,
  kind = "still",
  reducedMotion,
}: IlluminateButtonProps) {
  const { tokens } = useAppTheme();
  const toast = useToast();
  const [state, setState] = useState<RemoteIlluminationState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const accountId = auth?.accountId;
  const guestTokenHash = auth?.guestTokenHash;

  const refresh = useCallback(async () => {
    if (!accountId) return null;
    const next = await getRemoteIlluminationState({
      accountId,
      saveId,
      ...(guestTokenHash ? { guestTokenHash } : {}),
    });
    setState(next);
    return next;
  }, [accountId, guestTokenHash, saveId]);

  // Initial + scene-change load.
  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setState(null);
      return;
    }
    void (async () => {
      const next = await getRemoteIlluminationState({
        accountId,
        saveId,
        ...(guestTokenHash ? { guestTokenHash } : {}),
      });
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, guestTokenHash, saveId]);

  const mode = illuminateCandleMode(state, kind);
  const inFlight = mode === "queued" || mode === "generating";

  // Poll only while the candle is kindling — settles to a single read otherwise.
  useEffect(() => {
    if (!inFlight || !accountId) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, accountId, refresh]);

  const onConfirm = useCallback(async () => {
    if (submittingRef.current || !accountId || !state?.sceneId) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await requestRemoteIllumination({
        accountId,
        saveId,
        sceneId: state.sceneId,
        kind,
        ...(guestTokenHash ? { guestTokenHash } : {}),
      });
      if (!res) {
        toast.push({ message: "The candle would not catch. Try again.", tone: "warning" });
        return;
      }
      if (res.status === "insufficient_sparks") {
        toast.push({
          message: "Not sparks enough to light this page yet.",
          tone: "warning",
        });
        setSheetOpen(false);
        return;
      }
      // queued or already illuminated — either way the page will glow.
      toast.push({ message: "The page kindles.", tone: "success" });
      setSheetOpen(false);
      await refresh();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [accountId, guestTokenHash, kind, refresh, saveId, state, toast]);

  // Nothing to light (unresolved page / no session / local save) → render
  // nothing so the read is never interrupted.
  if (!accountId || mode === "hidden") return null;

  const glyph = candleGlyph(mode);
  const label = candleLabel(mode);
  const tappable = candleIsTappable(mode);
  const cost = illuminationCost(state, kind);
  const affordable = canAffordIllumination(state, kind);
  const previewUrl = state?.still.url;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !tappable }}
        disabled={!tappable}
        onPress={() => setSheetOpen(true)}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.xs,
          borderColor: mode === "illuminated" ? tokens.colors.accent : tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.xs,
          opacity: pressed && tappable && !reducedMotion ? 0.78 : 1,
        })}
      >
        <Text variant="caption">{glyph}</Text>
        <Text
          muted
          variant="caption"
          style={{ fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
        >
          {mode === "illuminated" ? "illuminated" : inFlight ? "kindling…" : "Illuminate this page"}
        </Text>
      </Pressable>

      <Modal
        visible={sheetOpen}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable
          accessibilityLabel="Close"
          onPress={() => setSheetOpen(false)}
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <Pressable
            // Swallow taps on the sheet body so they don't close the backdrop.
            onPress={() => undefined}
            style={{
              backgroundColor: tokens.colors.surface,
              borderTopLeftRadius: tokens.radii.md,
              borderTopRightRadius: tokens.radii.md,
              borderColor: tokens.colors.border,
              borderWidth: tokens.borderWidths.hairline,
              padding: tokens.spacing.lg,
              gap: tokens.spacing.md,
            }}
          >
            <Text variant="title" style={{ fontFamily: tokens.typography.families.serif }}>
              Illuminate this page
            </Text>
            <Text muted variant="body">
              A candle for the page you have already turned — light it, and the scene
              takes on colour. The words are yours already; this is only their glow.
            </Text>

            {/* ALWAYS-FREE preview: the scene's existing still, or a waiting frame. */}
            {previewUrl ? (
              <Image
                accessibilityLabel="This page's illustration"
                source={{ uri: previewUrl }}
                resizeMode="cover"
                style={{
                  width: "100%",
                  aspectRatio: 16 / 9,
                  borderRadius: tokens.radii.sm,
                  backgroundColor: tokens.colors.surfaceMuted,
                }}
              />
            ) : (
              <View
                accessibilityLabel="A candle waits"
                style={{
                  width: "100%",
                  aspectRatio: 16 / 9,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: tokens.radii.sm,
                  backgroundColor: tokens.colors.surfaceMuted,
                  borderColor: tokens.colors.border,
                  borderWidth: tokens.borderWidths.hairline,
                }}
              >
                <Text muted variant="caption" style={{ fontStyle: "italic" }}>
                  Unlit — the page waits in candleshadow.
                </Text>
              </View>
            )}

            <Text variant="body" style={{ fontFamily: tokens.typography.families.serif }}>
              {alightCopy(cost)}
            </Text>
            <Text muted variant="caption">
              {balanceCopy(state?.balance ?? 0)}
            </Text>

            <View style={{ flexDirection: "row", gap: tokens.spacing.sm }}>
              <Button
                variant="primary"
                disabled={submitting || !affordable || !state?.sceneId}
                onPress={() => void onConfirm()}
                style={{ flexGrow: 1 }}
              >
                {submitting ? "Lighting…" : affordable ? "Set it alight" : "Not sparks enough"}
              </Button>
              <Button variant="ghost" onPress={() => setSheetOpen(false)}>
                Not now
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
