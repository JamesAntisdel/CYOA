import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DailyResults } from "../../../components/daily";
import { AppNav } from "../../../components/navigation";
import { Button, Stamp, Text } from "../../../components/primitives";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import {
  getRemoteChoicePulseWithSave,
  getRemoteDailyResults,
  openingChoicesFromRunHistory,
  type RemoteDailyResults,
  type RemotePulseEntry,
} from "../../../lib/dailyApi";
import { getRemoteRunHistory } from "../../../lib/gameApi";
import { useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";

/**
 * Daily results route (design §4.3, R13.3) — the reader's ending against the
 * global distribution for a Daily Tale. Reached from the DailyCard's played /
 * already-played state. Guest-compatible (accountId + guestTokenHash).
 *
 * Daily Killcam 4.3: alongside the ending distribution, the "Opening forks"
 * recap strip lights up. It needs the reader's OWN turn-1..3 choice labels,
 * which the results route doesn't carry — so we fetch `getChoicePulse` (which
 * now also returns the reader's own `readerSaveId`) and, when present, fetch
 * that save's run history to read the reader's OWN opening labels (BC10-safe —
 * only the reader's own choices ever cross the wire). Both are decorative and
 * best-effort: any failure degrades to an empty strip, never an error surface.
 */
export default function DailyResultsRoute() {
  const { dailyId } = useLocalSearchParams<{ dailyId: string }>();
  const router = useRouter();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const [results, setResults] = useState<RemoteDailyResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulses, setPulses] = useState<readonly RemotePulseEntry[]>([]);
  const [openingChoices, setOpeningChoices] = useState<
    readonly { turnNumber: number; choiceLabel: string }[]
  >([]);

  const accountId = guest.session?.accountId;
  useEffect(() => {
    if (!accountId || !dailyId) return;
    let cancelled = false;
    setLoading(true);
    void getRemoteDailyResults({ dailyId, accountId, ...guestAuthArgs() }).then((res) => {
      if (cancelled) return;
      setResults(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, dailyId]);

  // Daily Killcam 4.3 — the opening-forks recap. Fetch the reader's pulse
  // buckets + their own daily save id, then (only when both exist) their OWN run
  // history for the turn-1..3 choice labels the strip joins to those buckets.
  // Best-effort: any failure clears both so the strip self-hides (BC5).
  useEffect(() => {
    if (!accountId || !dailyId) return;
    let cancelled = false;
    void getRemoteChoicePulseWithSave({ dailyId, accountId, ...guestAuthArgs() })
      .then(async ({ pulses: nextPulses, readerSaveId }) => {
        if (cancelled) return;
        setPulses(nextPulses);
        if (!readerSaveId || nextPulses.length === 0) {
          setOpeningChoices([]);
          return;
        }
        const history = await getRemoteRunHistory({
          accountId,
          saveId: readerSaveId,
          ...guestAuthArgs(),
        });
        if (cancelled) return;
        setOpeningChoices(openingChoicesFromRunHistory(history));
      })
      .catch(() => {
        if (cancelled) return;
        setPulses([]);
        setOpeningChoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, dailyId]);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.lg,
          marginHorizontal: "auto",
          maxWidth: 720,
          padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
          width: "100%",
        }}
      >
        <AppNav />
        <View style={{ gap: tokens.spacing.sm }}>
          <Stamp>daily tale</Stamp>
          <Text muted variant="bodySmall">
            How every reader ended today's shared tale.
          </Text>
        </View>

        <DailyResults
          loading={loading}
          openingChoices={openingChoices}
          pulses={pulses}
          results={results}
        />

        <Button accessibilityLabel="Back to cover" onPress={() => router.push("/")} variant="ghost">
          Back to the cover
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
