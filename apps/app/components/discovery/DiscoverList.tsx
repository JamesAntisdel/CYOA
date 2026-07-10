import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Chip, Stamp, Text } from "../primitives";
import { EmptyState } from "../states/EmptyState";
import {
  DiscoverCard,
  type DiscoverLength,
  type DiscoverTale,
  type DiscoverTier,
  type DiscoverTone,
} from "./DiscoverCard";

type ToneFilter = DiscoverTone | "any";
type LengthFilter = DiscoverLength | "any";
type TierFilter = DiscoverTier | "any";

type DiscoverListProps = {
  tales: DiscoverTale[];
  onOpen: (taleId: string) => void;
  onShare?: (taleId: string) => void;
};

const TONES: ToneFilter[] = ["any", "calm", "tense", "wry", "lyrical", "grim"];
const LENGTHS: LengthFilter[] = ["any", "short", "medium", "long"];
const TIERS: TierFilter[] = ["any", "free", "unlimited", "pro"];

function FilterRow<T extends string>({
  label,
  onSelect,
  options,
  value,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onSelect: (next: T) => void;
}) {
  const { tokens } = useAppTheme();

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Text muted style={{ textTransform: "uppercase" }} variant="caption">
        {label}
      </Text>
      <ScrollView
        contentContainerStyle={{ gap: tokens.spacing.sm, paddingRight: tokens.spacing.lg }}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              accessibilityLabel={`${label} filter ${opt}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={opt}
              onPress={() => onSelect(opt)}
            >
              <Chip
                style={{
                  backgroundColor: active ? tokens.colors.text : tokens.colors.surface,
                }}
              >
                <Text
                  style={{
                    color: active ? tokens.colors.background : tokens.colors.text,
                    fontWeight: active ? "700" : "500",
                  }}
                  variant="caption"
                >
                  {opt}
                </Text>
              </Chip>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Pure filter function exported for testability.
 */
export function filterTales(
  tales: DiscoverTale[],
  filters: { tone: ToneFilter; length: LengthFilter; tier: TierFilter; minCompletions: number },
): DiscoverTale[] {
  return tales.filter((tale) => {
    if (filters.tone !== "any" && tale.tone !== filters.tone) return false;
    if (filters.length !== "any" && tale.length !== filters.length) return false;
    if (filters.tier !== "any" && tale.tier !== filters.tier) return false;
    if (filters.minCompletions > 0) {
      const count = tale.completionCount ?? 0;
      if (count < filters.minCompletions) return false;
    }
    return true;
  });
}

/**
 * Discover list. Renders the tale archive with tone/length/tier/completion
 * filters. Falls back to a graceful empty state when no published tales exist
 * or when the active filters exclude every tale.
 */
export function DiscoverList({ onOpen, onShare, tales }: DiscoverListProps) {
  const { tokens } = useAppTheme();
  const [tone, setTone] = useState<ToneFilter>("any");
  const [length, setLength] = useState<LengthFilter>("any");
  const [tier, setTier] = useState<TierFilter>("any");
  const [minCompletions, setMinCompletions] = useState<number>(0);

  const filtered = useMemo(
    () => filterTales(tales, { tone, length, tier, minCompletions }),
    [length, minCompletions, tales, tier, tone],
  );

  if (tales.length === 0) {
    return (
      <EmptyState
        body="No published tales sit on the shelf yet. The first reader to publish will appear here."
        kicker="the shelf"
        title="The archive is still being written."
      />
    );
  }

  return (
    <View style={{ gap: tokens.spacing.lg }}>
      <View style={{ gap: tokens.spacing.sm }}>
        <Stamp>discover</Stamp>
        <Text variant="title">Tales other readers have left on the shelf.</Text>
      </View>

      <View style={{ gap: tokens.spacing.md }}>
        <FilterRow label="tone" onSelect={setTone} options={TONES} value={tone} />
        <FilterRow label="length" onSelect={setLength} options={LENGTHS} value={length} />
        <FilterRow label="tier" onSelect={setTier} options={TIERS} value={tier} />
        <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm, flexWrap: "wrap" }}>
          <Text muted style={{ textTransform: "uppercase" }} variant="caption">
            finished by
          </Text>
          {[0, 1, 10, 100].map((threshold) => {
            const active = threshold === minCompletions;
            return (
              <Pressable
                accessibilityLabel={`Minimum completions ${threshold}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={threshold}
                onPress={() => setMinCompletions(threshold)}
              >
                <Chip
                  style={{
                    backgroundColor: active ? tokens.colors.text : tokens.colors.surface,
                  }}
                >
                  <Text
                    style={{
                      color: active ? tokens.colors.background : tokens.colors.text,
                      fontWeight: active ? "700" : "500",
                    }}
                    variant="caption"
                  >
                    {threshold === 0 ? "anyone" : `${threshold}+ readers`}
                  </Text>
                </Chip>
              </Pressable>
            );
          })}
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          body="No tales match the filters you set. Loosen them and the shelf will fill again."
          kicker="empty filters"
          title="Nothing on the shelf matches that mood."
        />
      ) : (
        <View style={{ gap: tokens.spacing.md }}>
          {filtered.map((tale) => (
            <DiscoverCard
              key={tale.taleId}
              onOpen={onOpen}
              {...(onShare ? { onShare } : {})}
              tale={tale}
            />
          ))}
        </View>
      )}
    </View>
  );
}
