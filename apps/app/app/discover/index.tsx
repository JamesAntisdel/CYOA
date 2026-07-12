import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DiscoverList } from "../../components/discovery/DiscoverList";
import type { DiscoverTale } from "../../components/discovery/DiscoverCard";
import { PublishableShelf } from "../../components/discovery/PublishableShelf";
import {
  ShareModal,
  type ShareEligibility,
} from "../../components/discovery/ShareModal";
import { AppNav } from "../../components/navigation";
import { EmptyState } from "../../components/states/EmptyState";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary } from "../../hooks/useLibrary";
import { useToast } from "../../hooks/useToast";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Text } from "../../components/primitives";

/**
 * Discover route. Renders the archive of published tales for browse. The Convex
 * read-query for the public archive does not exist yet (see convex/tales.ts,
 * which exports pure model helpers, not Convex queries). Until a `publicTales`
 * query ships, the route renders an interim surface instead of a permanently
 * bare shelf: a "library grows as readers publish" empty state plus the
 * reader's own publishable saves with a CTA into the existing publish flow
 * (/publish/[saveId]). Guests without a session simply see the empty state.
 */
export default function DiscoverRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const { profile } = useAccountProfile();
  const { push } = useToast();
  const guest = useGuestSession();
  // Same save source the endings crypt uses; returns [] when signed out.
  const library = useLibrary(guest.session);
  // Phone reduces the page padding so the synopsis text gets a wider line
  // length on a 375px viewport. Desktop keeps the original spacing.xl gutter.
  const { isPhone } = useBreakpoint();
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
          gap: isPhone ? tokens.spacing.lg : tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 720,
          padding: isPhone ? tokens.spacing.md : tokens.spacing.xl,
          width: "100%",
        }}
      >
        <AppNav current="discover" />

        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>the archive</Stamp>
            <Text variant="display">Discover</Text>
            <Text muted variant="body">
              Tales other readers have published to the open shelf. Browse, read along, or take a copy and write your own ending.
            </Text>
          </View>

          {tales.length > 0 ? (
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
          ) : (
            <EmptyState
              body="No tale rests on the open shelf yet. The library grows as readers publish — every finished story bound and placed here takes up permanent residence, including yours."
              kicker="the open shelf"
              title="The library grows as readers publish."
            />
          )}

          <PublishableShelf
            onPublish={(saveId) => router.push(`/publish/${saveId}`)}
            saves={library.saves}
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
