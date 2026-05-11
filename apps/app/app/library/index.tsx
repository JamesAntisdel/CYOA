import { useRouter } from "expo-router";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { StorySummary } from "@cyoa/stories";

import { AgeGate } from "../../components/account/AgeGate";
import { ContinueReading, CoverCard } from "../../components/library";
import { Button, Stamp, Text } from "../../components/primitives";
import { useGuestSession, type AgeSelection } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";
import { useAppTheme } from "../../theme";

const MOBILE_BREAKPOINT = 720;

export default function LibraryRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const { tokens } = useAppTheme();
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;

  const handleAgeSubmit = (selection: AgeSelection) => {
    guest.createGuestSession(selection);
  };

  const openSave = (saveId: string) => {
    router.push(`/read/${saveId}`);
  };

  const launchStarter = (story: StorySummary) => {
    const save: LibrarySave = library.createSave(story.id);
    openSave(save.saveId);
  };

  if (!guest.session) {
    return (
      <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            alignItems: "center",
            flexGrow: 1,
            justifyContent: "center",
            padding: tokens.spacing.lg,
          }}
        >
          <AgeGate
            blockedMessage={guest.blocked ? guest.error : null}
            onSubmit={handleAgeSubmit}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 900,
          padding: isMobile ? tokens.spacing.lg : tokens.spacing.xl,
          paddingBottom: tokens.spacing.xxl,
          width: "100%",
        }}
      >
        <View
          style={{
            alignItems: "flex-start",
            flexDirection: "row",
            gap: tokens.spacing.md,
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: tokens.spacing.xs, flexShrink: 1 }}>
            <Stamp>shelf</Stamp>
            <Text variant="title">Choose a starter adventure.</Text>
          </View>
          <Button onPress={() => router.push("/")}>Cover</Button>
        </View>

        {library.continueSave ? (
          <ContinueReading
            save={library.continueSave}
            onContinue={(save) => openSave(save.saveId)}
          />
        ) : null}

        <View style={{ gap: tokens.spacing.md }}>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text variant="subtitle">Starters</Text>
            <Button variant="ghost" onPress={() => router.push("/creator")}>
              Seed your own
            </Button>
          </View>
          <View
            style={{
              flexDirection: isMobile ? "column" : "row",
              flexWrap: "wrap",
              gap: tokens.spacing.md,
            }}
          >
            {library.starterStories.map((story: StorySummary) => (
              <View
                key={story.id}
                style={{
                  flexBasis: isMobile ? "100%" : "47%",
                  flexGrow: 1,
                  minWidth: isMobile ? "100%" : 280,
                }}
              >
                <CoverCard
                  ctaLabel="Launch story"
                  difficulty={story.difficulty}
                  estimatedLength={story.estimatedLength}
                  onPress={() => launchStarter(story)}
                  summary={story.summary}
                  title={story.title}
                  tone={story.tone}
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
