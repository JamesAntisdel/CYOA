import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import {
  getRemoteDoorsJournal,
  hasRemoteGameApi,
  type RemoteDoorsJournalEntry,
} from "../../lib/gameApi";
import { doorJournalLine, doorsNewlyKeyed } from "../../lib/storyEngagement";
import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import { Surface, Text } from "../primitives";

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
};

/**
 * DoorsJournal (DOORS-JOURNAL — reader-facing half of the story-bible
 * fetch-quest loop; core-read-loop Req 22 companion surface). A quiet
 * ThreadsPill-style pill ("🚪 N doors the tome remembers") that expands into
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
export function DoorsJournal({ saveId, auth, sceneId }: DoorsJournalProps) {
  const { tokens } = useAppTheme();
  const toast = useToast();
  const [entries, setEntries] = useState<RemoteDoorsJournalEntry[] | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // Previous snapshot for the teased → key-in-hand transition detection.
  const prevEntriesRef = useRef<RemoteDoorsJournalEntry[] | undefined>(undefined);
  // Last scene we nudged for — the toast is a true one-shot per scene.
  const nudgedSceneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth?.accountId || !hasRemoteGameApi()) return;
    let cancelled = false;
    void (async () => {
      const next = await getRemoteDoorsJournal({
        accountId: auth.accountId,
        saveId,
        ...(auth.guestTokenHash ? { guestTokenHash: auth.guestTokenHash } : {}),
      });
      if (cancelled || next === null) return;
      const arrivals = doorsNewlyKeyed(prevEntriesRef.current, next);
      if (arrivals.length > 0 && nudgedSceneRef.current !== sceneId) {
        nudgedSceneRef.current = sceneId;
        toast.push({ message: "A key has turned up.", tone: "info" });
      }
      prevEntriesRef.current = next;
      setEntries(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.accountId, auth?.guestTokenHash, saveId, sceneId, toast]);

  // Zero-state invisible (ThreadsPill discipline): no teased doors → nothing.
  if (!entries || entries.length === 0) return null;

  const pillLabel = `🚪 ${entries.length} ${entries.length === 1 ? "door" : "doors"} the tome remembers`;

  return (
    <View style={{ alignSelf: "flex-start", gap: tokens.spacing.xs, maxWidth: "100%" }}>
      <Pressable
        accessibilityLabel={pillLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.xs,
        })}
      >
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
                <Text muted variant="caption">
                  🗝 the key waits in your satchel
                </Text>
              ) : null}
            </Surface>
          ))}
        </View>
      ) : null}
    </View>
  );
}
