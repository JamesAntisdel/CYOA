import { PropsWithChildren, ReactNode } from "react";
import { View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Surface, Text } from "../../primitives";

/**
 * Canvas § 25 ruled-header — mono kicker in uppercase + spaced
 * tracking, sitting above an italic display value. Used by every
 * metric tile, board header, and board sub-section.
 */
export function BoardKicker({ children }: PropsWithChildren) {
  const { tokens } = useAppTheme();
  return (
    <Text
      muted
      style={{
        fontFamily: tokens.typography.families.mono,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
      variant="caption"
    >
      {children}
    </Text>
  );
}

type BoardHeaderProps = {
  kicker: string;
  title: string;
  sub?: string;
};

/**
 * Ruled board header — matches the HCHead spec at the top of each
 * board in the canvas. Title is in the serif display family.
 */
export function BoardHeader({ kicker, sub, title }: BoardHeaderProps) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <BoardKicker>{kicker}</BoardKicker>
      <Text variant="subtitle">{title}</Text>
      {sub ? (
        <Text muted variant="bodySmall">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

type MetricTileProps = {
  label: string;
  value: string;
  sub?: string;
};

/**
 * Canvas § 25 Cell shape — mono kicker, italic display value, mono
 * sub-line. Used in the top-row hero strip on every board.
 */
export function MetricTile({ label, sub, value }: MetricTileProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      padded
      style={{
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 160,
      }}
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <BoardKicker>{label}</BoardKicker>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="title"
        >
          {value}
        </Text>
        {sub ? (
          <Text
            muted
            style={{ fontFamily: tokens.typography.families.mono }}
            variant="caption"
          >
            {sub}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}

type TileGridProps = PropsWithChildren<{
  /** Mobile-friendly grid: tiles wrap and grow to fill the row. */
  testID?: string;
}>;

export function TileGrid({ children, testID }: TileGridProps) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.sm,
      }}
      testID={testID}
    >
      {children}
    </View>
  );
}

type RuledRowProps = {
  label: ReactNode;
  value: ReactNode;
  emphasis?: "default" | "accent" | "danger";
};

/**
 * One row inside a board panel — left label in the body family,
 * right value in mono. Matches the Safety panel rows in canvas § 25.
 */
export function RuledRow({ emphasis = "default", label, value }: RuledRowProps) {
  const { tokens } = useAppTheme();
  const valueColor =
    emphasis === "danger"
      ? tokens.colors.danger
      : emphasis === "accent"
        ? tokens.colors.accent
        : tokens.colors.text;
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.md,
        justifyContent: "space-between",
      }}
    >
      <Text muted variant="bodySmall">
        {label}
      </Text>
      <Text
        style={{
          color: valueColor,
          fontFamily: tokens.typography.families.mono,
        }}
        variant="bodySmall"
      >
        {value}
      </Text>
    </View>
  );
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const pct = value * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatCents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
