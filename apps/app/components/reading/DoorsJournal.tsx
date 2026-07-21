import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import {
  getRemoteDoorsJournal,
  hasRemoteGameApi,
  type RemoteDoorsJournalEntry,
} from "../../lib/gameApi";
import { doorJournalLine, doorsNewlyKeyed, keyArrivalToast } from "../../lib/storyEngagement";
import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import { Icon, Surface, Text } from "../primitives";

type DoorsJournalProps = {
  saveId: string;
  /** Remote session auth — absent on local/tutorial saves (journal stays hidden). */
  auth?: { accountId: string; guestTokenHash?: string } | undefined;
  /**
   * Scene identity. The journal refetches when the reader advances (journal
   * state only changes on a completed turn), and the key-arrival nudge fires
   * at most once per scene — same discipline as ThreadsPill's echo toast.
   */
  sceneId: string;
  /**
   * Reader-chrome-declutter 3.4 (RB-COUNTS) — optional upward count callback.
   * Fired from the EXISTING fetch effect (no new query, RC2) with the number of
   * teased doors so StoryRibbon's COLLAPSED row can show a synchronous doors
   * segment; zero-state / no-auth / transport failure fire `0` so the segment
   * clears. Orthogonal to the key-arrival nudge: the single mount (StoryRibbon's
   * detail) both reports the count AND owns the one-shot toast (R3.3).
   */
  onCount?: ((count: number) => void) | undefined;
};

/**
 * DoorsJournal (DOORS-JOURNAL — reader-facing half of the story-bible
 * fetch-quest loop; core-read-loop Req 22 companion surface). A quiet
 * ThreadsPill-style pill (a `key` glyph + "N doors the tome remembers") that expands into
 * the journal of teased doors, written in the tome's voice ("The crypt gate
 * remembers you."). The server projection (`llm/storyBible:getDoorsJournal`)
 * only ever carries doors the reader has already seen rendered locked on
 * screen (BC10) — this component renders exactly what it is given.
 *
 * Zero-state invisible (matches ThreadsPill): saves with no teased doors —
 * legacy saves, bible-less saves, local saves — render NOTHING.
 *
 * When a teased door's key arrives (state flips teased → key-in-hand between
 * fetches), a one-shot "A key has turned up." toast nudges the reader — the
 * fetch-quest payoff signal, sibling to ThreadsPill's "An earlier choice
 * echoes."
 */
export function DoorsJournal({ saveId, auth, sceneId, onCount }: DoorsJournalProps) {
  const { tokens } = useAppTheme();
  const toast = useToast();
  const [entries, setEntries] = useState<RemoteDoorsJournalEntry[] | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // Previous snapshot for the teased → key-in-hand transition detection.
  const prevEntriesRef = useRef<RemoteDoorsJournalEntry[] | undefined>(undefined);
  // Last scene we nudged for — the toast is a true one-shot per scene.
  const nudgedSceneRef = useRef<string | null>(null);
  // Held in a ref so the count callback (and the reporter/toast gate) never
  // enters the fetch effect's deps — the fetch cadence stays byte-identical.
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  useEffect(() => {
    // No remote session ⇒ the journal stays dark; a reporter hears "no doors".
    if (!auth?.accountId || !hasRemoteGameApi()) {
      onCountRef.current?.(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await getRemoteDoorsJournal({
        accountId: auth.accountId,
        saveId,
        ...(auth.guestTokenHash ? { guestTokenHash: auth.guestTokenHash } : {}),
      });
      // A null fetch is a transport failure — surface it as "no doors" so a
      // reporter's collapsed segment self-hides (RC2), then bail as before.
      if (cancelled) return;
      if (next === null) {
        onCountRef.current?.(0);
        return;
      }
      const arrivals = doorsNewlyKeyed(prevEntriesRef.current, next);
      // There is exactly ONE DoorsJournal mount per reader (StoryRibbon's
      // detail — it both reports the count upward AND owns the key-arrival
      // nudge). The old `!onCount ⇒ toast owner` deferral existed for the
      // removed headless-twin mount; with a single mount it would silence the
      // toast entirely.
      if (arrivals.length > 0 && nudgedSceneRef.current !== sceneId) {
        nudgedSceneRef.current = sceneId;
        // Name the door the key belongs to and point at the pill above — the
        // old anonymous "A key has turned up." nudge named nothing and pointed
        // nowhere (panel-review-2 merged doors-journal idea). Auto-expand the
        // journal so the tap-through is immediate.
        setExpanded(true);
        toast.push({ message: keyArrivalToast(arrivals), tone: "info" });
      }
      prevEntriesRef.current = next;
      setEntries(next);
      onCountRef.current?.(next.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.accountId, auth?.guestTokenHash, saveId, sceneId, toast]);

  // Zero-state invisible (ThreadsPill discipline): no teased doors → nothing.
  if (!entries || entries.length === 0) return null;

  // R5 glyph discipline (RC5): the door count leads with the icon-font `key`
  // glyph, not the old door emoji. The a11y label is the plain-text phrase.
  const doorWord = entries.length === 1 ? "door" : "doors";
  const pillLabel = `${entries.length} ${doorWord} the tome remembers`;

  return (
    <View style={{ alignSelf: "flex-start", gap: tokens.spacing.xs, maxWidth: "100%" }}>
      <Pressable
        accessibilityLabel={pillLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => ({
          alignItems: "center",
          alignSelf: "flex-start",
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          flexDirection: "row",
          gap: tokens.spacing.xs,
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <Icon name="key" size={14} color={tokens.colors.textMuted} aria-hidden />
        <Text
          muted
          style={{ fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
          variant="caption"
        >
          {pillLabel}
        </Text>
      </Pressable>
      {expanded ? (
        <View
          accessibilityLabel="Doors the tome remembers"
          style={{ gap: tokens.spacing.xs }}
        >
          {entries.map((entry, index) => (
            <Surface
              key={`${entry.label}-${index}`}
              padded
              variant="muted"
              style={{ gap: 2 }}
            >
              <Text
                style={{
                  fontFamily: tokens.typography.families.serif,
                  fontStyle: "italic",
                }}
                variant="bodySmall"
              >
                {doorJournalLine(entry)}
              </Text>
              {entry.hint.length > 0 ? (
                <Text muted variant="caption">
                  {entry.hint}
                </Text>
              ) : null}
              {entry.state === "key-in-hand" ? (
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: tokens.spacing.xs,
                  }}
                >
                  <Icon name="key" size={13} color={tokens.colors.textMuted} aria-hidden />
                  <Text muted variant="caption">
                    the key waits in your satchel
                  </Text>
                </View>
              ) : null}
            </Surface>
          ))}
        </View>
      ) : null}
    </View>
  );
}
