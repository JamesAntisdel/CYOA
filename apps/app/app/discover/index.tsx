import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DiscoverList } from "../../components/discovery/DiscoverList";
import type { DiscoverTale } from "../../components/discovery/DiscoverCard";
import {
  ShareModal,
  type ShareEligibility,
} from "../../components/discovery/ShareModal";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Text } from "../../components/primitives";

/**
 * Discover route. Renders the archive of published tales for browse. The Convex
 * read-query for the public archive does not exist yet (see convex/tales.ts,
 * which exports pure model helpers, not Convex queries). Until a `publicTales`
 * query ships, the route renders an empty state — DiscoverList handles that
 * gracefully — and a single share modal hooked up for the day a tale arrives.
 */
export default function DiscoverRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const { profile } = useAccountProfile();
  const { push } = useToast();
  const [activeShareTale, setActiveShareTale] = useState<DiscoverTale | null>(null);

  // No public-tale Convex query exists yet; the shelf is empty by design.
  // When that query lands, replace this constant with a useQuery() call.
  const tales: DiscoverTale[] = useMemo(() => [], []);

  const eligibility: ShareEligibility = useMemo(() => {
    if (!activeShareTale) {
      return { eligible: false, reason: "no_link" };
    }
    if (!profile) {
      return { eligible: false, reason: "guest_account" };
    }
    if (profile.kind === "guest") {
      return { eligible: false, reason: "guest_account" };
    }
    return {
      eligible: true,
      shareUrl: `https://cyoa.app/tale/${activeShareTale.taleId}`,
    };
  }, [activeShareTale, profile]);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          marginHorizontal: "auto",
          maxWidth: 720,
          padding: tokens.spacing.xl,
          width: "100%",
        }}
      >
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>the archive</Stamp>
            <Text variant="display">Discover</Text>
            <Text muted variant="body">
              Tales other readers have published to the open shelf. Browse, read along, or take a copy and write your own ending.
            </Text>
          </View>

          <DiscoverList
            onOpen={(taleId) => router.push(`/tale/${taleId}`)}
            onShare={(taleId) => {
              const tale = tales.find((t) => t.taleId === taleId);
              if (tale) {
                setActiveShareTale(tale);
                return;
              }
              push({ message: "That tale slipped off the shelf. Refresh the page.", tone: "warning" });
            }}
            tales={tales}
          />

          <View style={{ marginTop: tokens.spacing.lg }}>
            <Button onPress={() => router.push("/library")} variant="ghost">
              Back to the library
            </Button>
          </View>
        </View>
      </ScrollView>

      <ShareModal
        eligibility={eligibility}
        onClose={() => setActiveShareTale(null)}
        synopsis={activeShareTale?.synopsis ?? ""}
        title={activeShareTale?.title ?? ""}
        visible={activeShareTale !== null}
      />
    </SafeAreaView>
  );
}
