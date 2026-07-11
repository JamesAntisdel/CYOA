import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DailyResults } from "../../../components/daily";
import { AppNav } from "../../../components/navigation";
import { Button, Stamp, Text } from "../../../components/primitives";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import { getRemoteDailyResults, type RemoteDailyResults } from "../../../lib/dailyApi";
import { useBreakpoint } from "../../../lib/responsive";
import { useAppTheme } from "../../../theme";

/**
 * Daily results route (design §4.3, R13.3) — the reader's ending against the
 * global distribution for a Daily Tale. Reached from the DailyCard's played /
 * already-played state. Guest-compatible (accountId + guestTokenHash).
 */
export default function DailyResultsRoute() {
  const { dailyId } = useLocalSearchParams<{ dailyId: string }>();
  const router = useRouter();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const [results, setResults] = useState<RemoteDailyResults | null>(null);
  const [loading, setLoading] = useState(true);

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

        <DailyResults loading={loading} results={results} />

        <Button accessibilityLabel="Back to cover" onPress={() => router.push("/")} variant="ghost">
          Back to the cover
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
