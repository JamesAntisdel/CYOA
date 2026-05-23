import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

export const FREEFORM_MAX_LENGTH = 200;

type FreeformChoiceProps = {
  /**
   * Fires when the reader submits non-empty trimmed text. The host owns the
   * round-trip (safety classification, network call, error reporting) — this
   * component is purely the input affordance.
   */
  onSubmit: (text: string) => void;
  /**
   * One of the regular A/B/C choices is in flight. The free-form row stays
   * visible but inert so the reader can see the same disabled state the
   * other choices show.
   */
  disabled?: boolean;
  /**
   * This free-form submission is in flight. The text input becomes read-only
   * and the submit button reads "Working" until the host calls back.
   */
  pending?: boolean;
  /**
   * Surface-level error returned by the host (safety block, length, network).
   * Rendered beneath the input in the same red treatment LockedChoiceCopy uses
   * so blocked-choice feedback is visually consistent.
   */
  error?: string | null;
  maxLength?: number;
};

/**
 * FreeformChoice — the "Option D" affordance for typed actions.
 *
 * Starts collapsed as a Choice-styled button labeled "Write your own…". On tap
 * it expands inline into a TextInput + Submit row, replacing the button. The
 * reader can type up to `maxLength` characters (200 by default — long enough
 * for a one-sentence action, short enough to keep LLM prompts disciplined).
 * Submit fires `onSubmit(trimmed)` only when the trimmed text is non-empty;
 * Cancel restores the collapsed state without firing anything.
 *
 * The component intentionally does NOT call any safety classifier itself —
 * that lives on the host (useTurn) and on the server. This keeps the
 * primitive testable in isolation and avoids burying policy in the UI.
 */
export function FreeformChoice({
  onSubmit,
  disabled = false,
  pending = false,
  error = null,
  maxLength = FREEFORM_MAX_LENGTH,
}: FreeformChoiceProps) {
  const { tokens } = useAppTheme();
  const [mode, setMode] = useState<"collapsed" | "open">("collapsed");
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput | null>(null);
  // Last value we optimistically cleared on Submit. Held so we can restore the
  // input verbatim if the host reports an error (safety block, network) —
  // the reader should never have to retype a 150-character action.
  const lastSubmittedRef = useRef<string | null>(null);

  // Error-recovery: if the host surfaces an error AFTER we optimistically
  // cleared, re-open the input and restore the original text so the reader
  // can edit and retry. Without this the error renders under the collapsed
  // button with no visible text to fix.
  useEffect(() => {
    if (error && lastSubmittedRef.current) {
      setText(lastSubmittedRef.current);
      setMode("open");
      lastSubmittedRef.current = null;
      // Focus restoration is best-effort; rAF lets the input mount first on web.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [error]);

  const trimmed = text.trim();
  const canSubmit = !disabled && !pending && trimmed.length > 0;

  // Optimistic clear + collapse on Submit. We previously watched `pending`
  // transition true → false in an effect, but in practice the input would
  // stay populated after a successful submit (parent streaming re-renders
  // and React 18 batching made the two-step ref tracking unreliable). Doing
  // the visible reset synchronously in the tap handler guarantees the input
  // is empty before the next render — and the error effect above restores
  // the text if the host rejects the submission.
  const handleSubmit = () => {
    if (!canSubmit) return;
    const value = trimmed;
    lastSubmittedRef.current = value;
    setText("");
    setMode("collapsed");
    onSubmit(value);
  };

  if (mode === "collapsed") {
    return (
      <View style={{ gap: tokens.spacing.xs }}>
        <Pressable
          accessibilityLabel="Write your own action"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled || pending}
          onPress={() => {
            setMode("open");
            // requestAnimationFrame keeps the focus call after the input mounts
            // on web; native is fine either way.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.accent,
            borderRadius: tokens.radii.sm,
            borderStyle: "dashed",
            borderWidth: tokens.borderWidths.regular,
            flexDirection: "row",
            gap: tokens.spacing.sm,
            minHeight: 48,
            opacity: disabled ? 0.55 : pressed ? 0.76 : 1,
            paddingHorizontal: tokens.spacing.md,
            paddingVertical: tokens.spacing.sm,
          })}
        >
          <Text aria-hidden style={{ color: tokens.colors.accent, fontWeight: "700" }}>
            {"✎"}
          </Text>
          <View style={{ flex: 1 }}>
            <Text>Write your own…</Text>
          </View>
        </Pressable>
        {error ? <FreeformError tokens={tokens} message={error} /> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <View
        style={{
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.accent,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.regular,
          gap: tokens.spacing.sm,
          padding: tokens.spacing.sm,
        }}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel="Your action"
          editable={!pending}
          maxLength={maxLength}
          multiline
          numberOfLines={2}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          placeholder="What do you do?"
          placeholderTextColor={tokens.colors.textMuted}
          returnKeyType="send"
          style={{
            color: tokens.colors.text,
            fontSize: 16,
            minHeight: 56,
            paddingHorizontal: tokens.spacing.sm,
            paddingVertical: tokens.spacing.xs,
            textAlignVertical: "top",
          }}
          value={text}
        />
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: tokens.spacing.sm,
            justifyContent: "flex-end",
          }}
        >
          <Text muted variant="caption">
            {trimmed.length}/{maxLength}
          </Text>
          <Pressable
            accessibilityLabel="Cancel writing your own action"
            accessibilityRole="button"
            disabled={pending}
            onPress={() => {
              // Clear the restore-on-error ref too — Cancel means "I'm done
              // with this draft," not "save it for later if something fails."
              lastSubmittedRef.current = null;
              setText("");
              setMode("collapsed");
            }}
            style={({ pressed }) => ({
              opacity: pending ? 0.55 : pressed ? 0.76 : 1,
              paddingHorizontal: tokens.spacing.sm,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text muted variant="caption">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Submit your action"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={({ pressed }) => ({
              backgroundColor: canSubmit ? tokens.colors.accent : tokens.colors.surfaceMuted,
              borderRadius: tokens.radii.sm,
              opacity: pressed && canSubmit ? 0.82 : 1,
              paddingHorizontal: tokens.spacing.md,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text style={{ color: tokens.colors.background, fontWeight: "700" }}>
              {pending ? "Working" : "Submit"}
            </Text>
          </Pressable>
        </View>
      </View>
      {error ? <FreeformError tokens={tokens} message={error} /> : null}
    </View>
  );
}

function FreeformError({
  tokens,
  message,
}: {
  tokens: ReturnType<typeof useAppTheme>["tokens"];
  message: string;
}) {
  return (
    <View
      accessibilityLabel="Free-form choice error"
      style={{
        borderColor: tokens.colors.danger,
        borderLeftWidth: tokens.borderWidths.regular,
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.sm,
      }}
    >
      <Text style={{ color: tokens.colors.danger, fontWeight: "700" }} variant="caption">
        That action can't go into the story
      </Text>
      <Text muted variant="bodySmall">
        {message}
      </Text>
    </View>
  );
}
