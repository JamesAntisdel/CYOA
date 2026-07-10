import { useState } from "react";
import { Pressable, View } from "react-native";

import type { RemoteArc } from "../../lib/gameApi";
import { beatDots, romanAct } from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Stamp, Surface, Text } from "../primitives";

type QuestLineProps = {
  /**
   * Reader-visible arc summary (design §7). Undefined on legacy saves — the
   * strip renders nothing so the book stays quiet (product principle 1,
   * R1.6 / BC9).
   */
  arc?: RemoteArc | undefined;
};

/**
 * QuestLine (design §4.1, R1.5) — a single serif-italic muted strip under
 * AppNav that answers "what am I playing FOR": the dramatic question, the
 * current act, and count-only beat progress ("❝…❞ · Act II · ●●○○"). It is
 * deliberately whisper-quiet and hides entirely when the save has no arc.
 *
 * Tapping it opens an inline peek-drawer with the fuller arc panel
 * (question / want / stakes / act / fired-beat list with turn numbers /
 * thread count). NEVER shows pending beat labels or candidate endings — those
 * are spoilers and are not present in the projection (BC10). The want / stakes
 * / fired-beat enrichment is optional (see the RemoteArc integrator note); the
 * drawer omits any section the server didn't send.
 */
export function QuestLine({ arc }: QuestLineProps) {
  const { tokens } = useAppTheme();
  const [open, setOpen] = useState(false);

  if (!arc) return null;

  const act = romanAct(arc.act);
  const dots = beatDots(arc.beatsFired, arc.beatsTotal);
  const firedBeats = arc.firedBeats ?? [];
  const summary = `Your pursuit: ${arc.dramaticQuestion}. Act ${act}. ${arc.beatsFired} of ${arc.beatsTotal} beats landed.`;

  return (
    <View style={{ alignSelf: "stretch", gap: tokens.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={open ? "Hide the pursuit details" : "Show the pursuit details"}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          opacity: pressed ? 0.7 : 1,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            color: tokens.colors.textMuted,
            flex: 1,
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="bodySmall"
        >
          {`❝${arc.dramaticQuestion}❞`}
        </Text>
        <Text
          style={{
            color: tokens.colors.textFaint,
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 1,
          }}
          variant="caption"
        >
          {`Act ${act} · ${dots}`}
        </Text>
      </Pressable>

      {open ? (
        <Surface
          accessibilityLabel="Your pursuit"
          padded
          style={{ gap: tokens.spacing.md }}
          variant="muted"
        >
          <View style={{ gap: tokens.spacing.xs }}>
            <Stamp>{`Act ${act}${arc.actLabel ? ` — ${arc.actLabel}` : ""}`}</Stamp>
            <Text
              style={{
                fontFamily: tokens.typography.families.serif,
                fontStyle: "italic",
              }}
              variant="subtitle"
            >
              {arc.dramaticQuestion}
            </Text>
          </View>

          {arc.protagonistWant ? (
            <ArcRow label="What you want" value={arc.protagonistWant} />
          ) : null}
          {arc.stakes ? <ArcRow label="What you stand to lose" value={arc.stakes} /> : null}

          <ArcRow
            label="Beats landed"
            value={`${arc.beatsFired} of ${arc.beatsTotal}   ${dots}`}
          />

          {firedBeats.length > 0 ? (
            <View style={{ gap: tokens.spacing.xs }}>
              <ArcCaption>Turning points</ArcCaption>
              {firedBeats.map((beat, index) => (
                <Text key={`${beat.turnNumber}-${index}`} variant="bodySmall">
                  {`⭑ ${beat.label}`}
                  <Text muted variant="caption">{`  · turn ${beat.turnNumber}`}</Text>
                </Text>
              ))}
            </View>
          ) : null}

          <ArcRow
            label="Threads yet to pull"
            value={`🧵 ${arc.threadsPending}`}
          />
        </Surface>
      ) : null}
    </View>
  );
}

function ArcCaption({ children }: { children: string }) {
  const { tokens } = useAppTheme();
  return (
    <Text
      muted
      style={{
        fontFamily: tokens.typography.families.mono,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
      variant="caption"
    >
      {children}
    </Text>
  );
}

function ArcRow({ label, value }: { label: string; value: string }) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: 2 }}>
      <ArcCaption>{label}</ArcCaption>
      <Text variant="bodySmall">{value}</Text>
    </View>
  );
}
