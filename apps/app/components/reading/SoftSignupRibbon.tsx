import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Button, Field, Surface, Text } from "../primitives";
import { SOFT_SIGNUP_COPY } from "./softSignup";

/**
 * Panel-2 Wave 2 — the turn-3 soft-signup ribbon (panel-review-2 ranked idea:
 * "bind this tale to your name"). A one-shot, dismissible narrator-voiced ribbon
 * shown to GUEST readers around turn 3 with an inline email field that claims
 * the guest account in place (no route change — Principle 5's flow rule). The
 * copy is honest: guest saves really are purged after 7 days, so the urgency is
 * true, not manufactured.
 *
 * State machine: idle → submitting → done (on success, a brief confirmation
 * before the caller stops rendering because `profile.kind` flips to "claimed").
 * On invalid email / failure the field shows the error and stays open.
 *
 * The DISMISSAL persistence and the trigger gate (turn >= 3 && kind === guest)
 * live in the caller (ReaderScreen) + `softSignup.ts` so this stays a pure
 * presentational + submit surface.
 */
export type SoftSignupRibbonProps = {
  /** Claim the guest account with this email. Throws on invalid / failure. */
  onClaim: (email: string) => Promise<unknown>;
  /** Persist the one-shot dismissal and stop rendering. */
  onDismiss: () => void;
};

export function SoftSignupRibbon({ onClaim, onDismiss }: SoftSignupRibbonProps) {
  const { tokens } = useAppTheme();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (status === "submitting") return;
    setError(null);
    setStatus("submitting");
    try {
      await onClaim(email);
      setStatus("done");
    } catch (err) {
      const code = err instanceof Error ? err.message : "claim_failed";
      setError(
        code === "valid_email_required"
          ? "That doesn't look like an email — try again."
          : "Couldn't bind the tale just now. Try again in a moment.",
      );
      setStatus("idle");
    }
  };

  return (
    <Surface
      padded
      accessibilityLabel="Bind this tale to your name"
      style={{
        alignSelf: "stretch",
        borderColor: tokens.colors.accent,
        borderWidth: tokens.borderWidths.hairline,
        gap: tokens.spacing.sm,
      }}
    >
      <View
        style={{
          alignItems: "flex-start",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{ flexShrink: 1, fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
          variant="bodySmall"
        >
          {SOFT_SIGNUP_COPY}
        </Text>
        {status !== "done" ? (
          <Pressable
            accessibilityLabel="Dismiss the reminder"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDismiss}
            style={{ minHeight: 32, minWidth: 32, alignItems: "center", justifyContent: "center" }}
          >
            <Text muted variant="body">
              ✕
            </Text>
          </Pressable>
        ) : null}
      </View>

      {status === "done" ? (
        <Text tone="accent" variant="bodySmall">
          Bound. This tale is yours to keep.
        </Text>
      ) : (
        <View style={{ gap: tokens.spacing.sm }}>
          <Field
            accessibilityLabel="Email to bind this tale"
            autoCapitalize="none"
            autoComplete="email"
            editable={status !== "submitting"}
            error={error}
            keyboardType="email-address"
            label={null}
            onChangeText={(text) => setEmail(text)}
            onSubmitEditing={() => void submit()}
            placeholder="you@example.com"
            value={email}
          />
          <Button
            accessibilityLabel="Bind this tale to your name"
            onPress={() => void submit()}
            variant="primary"
          >
            {status === "submitting" ? "Binding…" : "Bind this tale"}
          </Button>
        </View>
      )}
    </Surface>
  );
}
