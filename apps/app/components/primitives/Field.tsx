import { forwardRef, useState } from "react";
import {
  StyleProp,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

/**
 * Canonical text-input field. Every form-like surface in the app routes
 * through this primitive so:
 *   - label / helpText / error wording lives in one place,
 *   - border + focus state + disabled treatment stay consistent across
 *     account, login, settings, and any future account-flow surface,
 *   - typography and spacing all derive from theme tokens — never inline
 *     hex codes or magic px values.
 *
 * Drift-guard: see
 * `apps/app/components/account/__tests__/formDrift.test.mjs` — that test
 * grep-checks the owned routes for raw `<TextInput>` and fails if a new
 * one slips in. Migrate inline inputs to this primitive instead.
 */
export type FieldProps = Omit<TextInputProps, "style"> & {
  /** Visible label rendered above the input. Pass null to omit. */
  label?: string | null;
  /**
   * Tone-down helper text rendered under the input. Mutually inclusive
   * with `error` — when error is set, that takes precedence visually
   * but helpText still renders so layout is stable.
   */
  helpText?: string | null;
  /** Error string. Renders in the danger color; replaces helpText slot. */
  error?: string | null;
  /** Style passthrough for the outer field column (label+input+helpText). */
  containerStyle?: StyleProp<ViewStyle>;
  /** Style passthrough for the input itself. */
  inputStyle?: StyleProp<TextStyle>;
};

// Minimum tappable height aligned with Button (WCAG 2.5.5). Kept as a named
// constant so the magic number stays out of inline styles.
const MIN_INPUT_HEIGHT = 46;

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  {
    label,
    helpText,
    error,
    containerStyle,
    inputStyle,
    editable = true,
    onBlur,
    onFocus,
    placeholderTextColor,
    ...inputProps
  },
  ref,
) {
  const { tokens } = useAppTheme();
  const [focused, setFocused] = useState(false);

  // Focus state lifts the border to the strong `border` token (away from
  // `borderMuted`) without changing layout — no padding/border-width swap
  // so the input doesn't reflow on focus.
  const borderColor = error
    ? tokens.colors.danger
    : focused
      ? tokens.colors.border
      : tokens.colors.borderMuted;

  return (
    <View style={[{ gap: tokens.spacing.xs }, containerStyle]}>
      {label ? (
        <Text muted variant="caption">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        editable={editable}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={placeholderTextColor ?? tokens.colors.textFaint}
        style={[
          {
            backgroundColor: tokens.colors.surface,
            borderColor,
            borderRadius: tokens.radii.md,
            borderWidth: tokens.borderWidths.regular,
            color: tokens.colors.text,
            fontFamily: tokens.typography.families.body,
            fontSize: tokens.typography.body,
            minHeight: MIN_INPUT_HEIGHT,
            opacity: editable ? 1 : 0.6,
            paddingHorizontal: tokens.spacing.md,
            paddingVertical: tokens.spacing.sm,
          } satisfies TextStyle,
          inputStyle,
        ]}
        {...inputProps}
      />
      {error ? (
        <Text tone="danger" variant="caption">
          {error}
        </Text>
      ) : helpText ? (
        <Text tone="muted" variant="caption">
          {helpText}
        </Text>
      ) : null}
    </View>
  );
});
