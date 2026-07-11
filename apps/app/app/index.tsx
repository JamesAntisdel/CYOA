import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";

import { AgeGate } from "../components/account/AgeGate";
import { DailyCard } from "../components/daily";
import { AppNav } from "../components/navigation";
import { Button, Text } from "../components/primitives";
import { brandAssets, getStoryCoverSource } from "../lib/designAssets";
import {
  getRemoteDailyToday,
  startRemoteDaily,
  type RemoteDailyToday,
} from "../lib/dailyApi";
import { useBreakpoint } from "../lib/responsive";
import { getTutorialStory, useLibrary, type LibrarySave } from "../hooks/useLibrary";
import { guestAuthArgs, useGuestSession, type AgeSelection } from "../hooks/useGuestSession";
import { useNarratorVoice } from "../hooks/useNarratorVoice";
import { useAppTheme } from "../theme";

/**
 * Landing / cover route. Every color/spacing/typography value resolves
 * through `useAppTheme().tokens` so the page paints correctly in day,
 * night, and sepia. The previous version hardcoded a sepia palette in
 * StyleSheet.create which rendered tan-on-tan when the theme provider
 * was set to Day or Night.
 *
 * Drift guard: see
 * `apps/app/components/reading/__tests__/themedSurfaces.test.mjs`.
 */
export default function IndexRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const { tokens } = useAppTheme();
  // Responsive breakpoints: phone (<520) stacks every multi-column row.
  // Hero cover and starter-tale story cards both branch off `isPhone`.
  const { isPhone, width: viewportWidth } = useBreakpoint();
  // Cover screen has no active save yet — passing null gives us the
  // reader's last-used voice (or DEFAULT_VOICE_ID on first launch). The
  // resolved voiceId rides along with createRemoteSave so the backend
  // can pin it to the new save record.
  const narrator = useNarratorVoice(null);
  const tutorialStory = getTutorialStory(library.starterStories);

  const handleAgeSubmit = (selection: AgeSelection) => {
    void guest.createGuestSession(selection);
  };

  const openSave = (saveId: string) => {
    router.push(`/read/${saveId}`);
  };

  // Story-engagement Wave 3 (R13.4): today's Daily Tale card. Fetched once the
  // guest session exists; hidden when there's no row for today (the card
  // returns null). BC1 paths live in `lib/dailyApi.ts`.
  const [dailyToday, setDailyToday] = useState<RemoteDailyToday | null>(null);
  const accountId = guest.session?.accountId;
  useEffect(() => {
    if (!accountId) {
      setDailyToday(null);
      return;
    }
    let cancelled = false;
    void getRemoteDailyToday({ accountId, ...guestAuthArgs() }).then((today) => {
      if (!cancelled) setDailyToday(today);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const launchTutorial = async () => {
    const save = await library.launchTutorialSave(narrator.voiceId);
    openSave(save.saveId);
  };

  if (guest.status === "loading") {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: tokens.colors.background,
          flex: 1,
          justifyContent: "center",
          padding: tokens.spacing.xl,
        }}
      >
        <Text muted variant="body">
          Opening the cover...
        </Text>
      </View>
    );
  }

  if (!guest.session) {
    return (
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          backgroundColor: tokens.colors.background,
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
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      <View style={{ gap: tokens.spacing.lg, maxWidth: 900, width: "100%" }}>
        {/* No `current` on the landing surface — there's no canonical tab
            for the cover, and highlighting an unrelated tab would feel
            misleading. */}
        <AppNav />

        <DailyCard
          daily={dailyToday}
          onOpenReader={openSave}
          onOpenResults={(dailyId) => router.push(`/daily/${dailyId}`)}
          onStart={() =>
            accountId
              ? startRemoteDaily({ accountId, ...guestAuthArgs() })
              : Promise.resolve(null)
          }
        />

        <View
          accessibilityLabel="The Unwritten story cover"
          style={{
            alignItems: "center",
            backgroundColor: tokens.colors.text,
            borderRadius: tokens.radii.sm,
            // Mobile: don't pin a tall fixed height — the OG image keeps a
            // 1200x630 aspect ratio so the panel naturally sizes itself to
            // image + overlay copy. Desktop keeps the original framed look.
            minHeight: isPhone ? 280 : 420,
            overflow: "hidden",
            padding: tokens.spacing.md,
            paddingBottom: isPhone ? tokens.spacing.xxl : tokens.spacing.md,
            position: "relative",
          }}
        >
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={brandAssets.ogCard}
            style={{
              aspectRatio: 1200 / 630,
              // Phone: let the image fluid-size up to the viewport so the
              // 1200x630 art stays readable. Desktop retains the 294 fixed
              // height and 560 maxWidth that read well in the framed look.
              height: isPhone ? undefined : 294,
              maxWidth: isPhone ? Math.min(viewportWidth - 32, 480) : 560,
              opacity: 0.92,
              width: "100%",
            }}
          />
          <View
            style={{
              backgroundColor: tokens.colors.overlay,
              bottom: 0,
              gap: tokens.spacing.sm,
              left: 0,
              paddingHorizontal: tokens.spacing.xl,
              paddingVertical: tokens.spacing.md,
              position: "absolute",
              right: 0,
              width: "100%",
            }}
          >
            <Text
              style={{
                color: tokens.colors.accent,
                fontFamily: tokens.typography.families.mono,
                fontWeight: "800",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
              variant="caption"
            >
              Chapter Zero
            </Text>
            <Text
              style={{
                color: tokens.colors.background,
                fontWeight: "800",
                maxWidth: 640,
              }}
              variant="title"
            >
              A living book waits at the threshold.
            </Text>
            <Text
              style={{ color: tokens.colors.background, maxWidth: 540 }}
              variant="body"
            >
              Start as a guest. Sign up can wait until the tale is worth keeping.
            </Text>
          </View>
        </View>

        <View
          style={{
            // Phone: stack vertically so Continue {long-title} doesn't wrap
            // awkwardly next to Start. Tablet/desktop keeps the side-by-side
            // row with flex-wrap as a safety net.
            alignItems: isPhone ? "stretch" : "flex-start",
            flexDirection: isPhone ? "column" : "row",
            flexWrap: "wrap",
            gap: tokens.spacing.sm,
          }}
        >
          <Button
            accessibilityLabel={tutorialStory ? `Start ${tutorialStory.title}` : "Start Tutorial"}
            onPress={launchTutorial}
            variant="primary"
          >
            {tutorialStory ? `Start ${tutorialStory.title}` : "Start Tutorial"}
          </Button>
          {library.continueSave ? (
            <Button
              accessibilityLabel={`Continue ${library.continueSave.title}`}
              onPress={() => openSave(library.continueSave!.saveId)}
              variant="secondary"
            >
              Continue {library.continueSave.title}
            </Button>
          ) : null}
        </View>
      </View>

      <View style={{ gap: tokens.spacing.sm, maxWidth: 900, width: "100%" }}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontWeight: "800" }} variant="subtitle">
            Starter adventures
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/library")}>
            <Text tone="accent" style={{ fontWeight: "800" }} variant="bodySmall">
              See all
            </Text>
          </Pressable>
        </View>
        <View style={{ gap: tokens.spacing.sm }}>
          {library.starterStories.slice(0, 3).map((story: StorySummary) => (
            <Pressable
              accessibilityRole="button"
              key={story.id}
              onPress={async () => {
                const save: LibrarySave = await library.createSave(
                  story.id,
                  "story",
                  undefined,
                  narrator.voiceId,
                );
                openSave(save.saveId);
              }}
              style={{
                alignItems: "stretch",
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.border,
                borderRadius: tokens.radii.sm,
                borderWidth: tokens.borderWidths.hairline,
                // Horizontal card on every viewport: cover thumbnail on
                // the left, body text on the right. Earlier we stacked
                // to a column on phone, which made each card eat the
                // full screen — even with the cover capped at 240 px wide
                // the card became ~500 px tall. A compact row card fits
                // 3+ titles above the fold on a 667 px phone.
                flexDirection: "row",
                gap: tokens.spacing.sm,
                overflow: "hidden",
              }}
            >
              {/*
                Compact cover thumbnail. 88×126 on phone, 104×170 on
                desktop — both 7:10 book-cover aspect. The dark slipcase
                background reads as "this is a book, the title is on the
                spine" without dominating the card.
              */}
              <Image
                accessibilityLabel={`${story.title} cover`}
                resizeMode="contain"
                source={getStoryCoverSource(story.id)}
                style={{
                  aspectRatio: 7 / 10,
                  backgroundColor: tokens.colors.text,
                  height: isPhone ? 126 : 170,
                  width: isPhone ? 88 : 104,
                }}
              />
              <View
                style={{
                  flex: 1,
                  gap: tokens.spacing.sm,
                  justifyContent: "center",
                  padding: tokens.spacing.md,
                }}
              >
                <Text
                  muted
                  style={{
                    fontFamily: tokens.typography.families.mono,
                    fontWeight: "800",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                  variant="caption"
                >
                  {story.difficulty.toUpperCase()} · {story.estimatedLength}
                </Text>
                <Text style={{ fontWeight: "800" }} variant="subtitle">
                  {story.title}
                </Text>
                <Text muted variant="bodySmall">
                  {story.summary}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
