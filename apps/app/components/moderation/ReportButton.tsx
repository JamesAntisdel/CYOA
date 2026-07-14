import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import {
  REPORT_REASONS,
  reportContent,
  type ReportReason,
  type ReportTargetType,
} from "../../lib/moderationApi";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type ReportButtonProps = {
  /** What kind of thing is being reported (drives the moderation queue). */
  targetType: ReportTargetType;
  /** The id of the reported artifact (tale id, seed id, save id, …). */
  targetId: string;
  /** Human title of the thing being reported (display only). */
  targetLabel?: string;
  /** Render style: a quiet text link (default) or a bordered chrome pill. */
  variant?: "link" | "pill";
  /** Visible label; defaults to "Report". */
  label?: string;
};

type SubmitState = "idle" | "submitting" | "done" | "error" | "no_session";

/**
 * A self-contained "Report" affordance (product-readiness launch blocker:
 * Apple 1.2 / Play UGC + GenAI require an in-app report path for every piece of
 * user- or AI-generated content). Opens a small reason picker and writes a
 * report via `moderation:reportContent`. Reporting requires a session (guest is
 * fine); with no session it explains that a session is needed rather than
 * silently failing.
 *
 * Drop it beside any UGC surface: `<ReportButton targetType="tale" targetId=… />`.
 */
export function ReportButton({
  targetType,
  targetId,
  targetLabel,
  variant = "link",
  label = "Report",
}: ReportButtonProps) {
  const { tokens } = useAppTheme();
  const guest = useGuestSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [state, setState] = useState<SubmitState>("idle");

  const reset = () => {
    setReason(null);
    setState("idle");
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    if (!reason) return;
    if (!guest.session) {
      setState("no_session");
      return;
    }
    setState("submitting");
    try {
      const result = await reportContent({
        accountId: guest.session.accountId,
        targetType,
        targetId,
        reason,
        ...guestAuthArgs(),
      });
      setState(result ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  const triggerStyle =
    variant === "pill"
      ? ({ pressed }: { pressed: boolean }) => ({
          alignItems: "center" as const,
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderStyle: "dashed" as const,
          borderWidth: tokens.borderWidths.hairline,
          justifyContent: "center" as const,
          minHeight: 44,
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.sm,
        })
      : ({ pressed }: { pressed: boolean }) => ({
          alignSelf: "flex-start" as const,
          opacity: pressed ? 0.6 : 1,
          paddingVertical: tokens.spacing.xs,
        });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Report ${targetLabel ?? "this content"}`}
        onPress={() => setOpen(true)}
        style={triggerStyle}
      >
        <Text
          style={{
            color: tokens.colors.textMuted,
            fontWeight: variant === "pill" ? "800" : "700",
          }}
          variant="bodySmall"
        >
          {variant === "pill" ? `⚑ ${label}` : label}
        </Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}
      >
        <SafeAreaView
          style={{
            backgroundColor: "rgba(0,0,0,0.6)",
            flex: 1,
            justifyContent: "center",
            padding: tokens.spacing.lg,
          }}
        >
          <Surface padded style={{ gap: tokens.spacing.md, maxWidth: 520, width: "100%" }}>
            <View style={{ gap: tokens.spacing.xs }}>
              <Stamp>flag for review</Stamp>
              <Text variant="title">Report this content</Text>
              <Text muted variant="bodySmall">
                {targetLabel
                  ? `Tell the keepers what's wrong with "${targetLabel}". A moderator reviews every report.`
                  : "Tell the keepers what's wrong. A moderator reviews every report."}
              </Text>
            </View>

            {state === "done" ? (
              <View style={{ gap: tokens.spacing.sm }}>
                <Text>Thank you. This has been sent to the keepers for review.</Text>
                <Button accessibilityLabel="Close report" onPress={close} variant="primary">
                  Close
                </Button>
              </View>
            ) : (
              <>
                <ScrollView style={{ maxHeight: 320 }}>
                  <View accessibilityRole="radiogroup" style={{ gap: tokens.spacing.sm }}>
                    {REPORT_REASONS.map((option) => {
                      const selected = reason === option.value;
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          key={option.value}
                          onPress={() => setReason(option.value)}
                          style={{
                            alignItems: "center",
                            backgroundColor: selected
                              ? tokens.colors.surfaceMuted
                              : tokens.colors.surface,
                            borderColor: selected ? tokens.colors.border : tokens.colors.borderMuted,
                            borderRadius: tokens.radii.sm,
                            borderWidth: tokens.borderWidths.regular,
                            flexDirection: "row",
                            gap: tokens.spacing.sm,
                            minHeight: 48,
                            padding: tokens.spacing.md,
                          }}
                        >
                          <View
                            style={{
                              backgroundColor: selected ? tokens.colors.text : "transparent",
                              borderColor: tokens.colors.border,
                              borderRadius: 9,
                              borderWidth: tokens.borderWidths.regular,
                              height: 18,
                              width: 18,
                            }}
                          />
                          <Text style={{ flex: 1 }}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                {state === "error" ? (
                  <Text tone="danger" variant="bodySmall">
                    Couldn't send the report — please try again.
                  </Text>
                ) : null}
                {state === "no_session" ? (
                  <Text tone="danger" variant="bodySmall">
                    Start a session (pass the age gate) before reporting.
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", gap: tokens.spacing.sm }}>
                  <Button
                    accessibilityLabel="Cancel report"
                    onPress={close}
                    style={{ flex: 1 }}
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    accessibilityLabel="Submit report"
                    disabled={!reason || state === "submitting"}
                    onPress={() => void submit()}
                    style={{ flex: 1 }}
                    variant="primary"
                  >
                    {state === "submitting" ? "Sending…" : "Submit report"}
                  </Button>
                </View>
              </>
            )}
          </Surface>
        </SafeAreaView>
      </Modal>
    </>
  );
}
