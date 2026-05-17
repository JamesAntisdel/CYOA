import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";

import { AgeGate } from "../components/account/AgeGate";
import { AppNav } from "../components/navigation";
import { brandAssets, getStoryCoverSource } from "../lib/designAssets";
import { getTutorialStory, useLibrary, type LibrarySave } from "../hooks/useLibrary";
import { useGuestSession, type AgeSelection } from "../hooks/useGuestSession";
import { useNarratorVoice } from "../hooks/useNarratorVoice";

export default function IndexRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
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

  const launchTutorial = async () => {
    const save = await library.launchTutorialSave(narrator.voiceId);
    openSave(save.saveId);
  };

  if (guest.status === "loading") {
    return (
      <View style={styles.centeredPage}>
        <Text style={styles.loadingText}>Opening the cover...</Text>
      </View>
    );
  }

  if (!guest.session) {
    return (
      <ScrollView contentContainerStyle={styles.gatePage}>
        <AgeGate
          blockedMessage={guest.blocked ? guest.error : null}
          onSubmit={handleAgeSubmit}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <AppNav current="home" />

        <View accessibilityLabel="The Unwritten story cover" style={styles.cover}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={brandAssets.ogCard}
            style={styles.coverArt}
          />
          <View style={styles.coverScrim}>
            <Text style={styles.coverKicker}>Chapter Zero</Text>
            <Text style={styles.coverTitle}>A living book waits at the threshold.</Text>
            <Text style={styles.coverCopy}>
              Start as a guest. Sign up can wait until the tale is worth keeping.
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={launchTutorial} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>
              {tutorialStory ? `Start ${tutorialStory.title}` : "Start Tutorial"}
            </Text>
          </Pressable>
          {library.continueSave ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openSave(library.continueSave!.saveId)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>
                Continue {library.continueSave.title}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Starter adventures</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/library")}>
            <Text style={styles.textButton}>See all</Text>
          </Pressable>
        </View>
        <View style={styles.storyList}>
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
              style={styles.storyCard}
            >
              <Image
                accessibilityLabel={`${story.title} cover`}
                resizeMode="contain"
                source={getStoryCoverSource(story.id)}
                style={styles.storyCover}
              />
              <View style={styles.storyBody}>
                <Text style={styles.storyMeta}>
                  {story.difficulty.toUpperCase()} · {story.estimatedLength}
                </Text>
                <Text style={styles.storyTitle}>{story.title}</Text>
                <Text style={styles.storySummary}>{story.summary}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centeredPage: {
    alignItems: "center",
    backgroundColor: "#efe2c8",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  gatePage: {
    alignItems: "center",
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    justifyContent: "center",
    padding: 18,
  },
  page: {
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    gap: 24,
    padding: 18,
  },
  loadingText: {
    color: "#594635",
    fontSize: 16,
  },
  hero: {
    gap: 18,
    maxWidth: 900,
    width: "100%",
  },
  textButton: {
    color: "#7b3f20",
    fontSize: 15,
    fontWeight: "700",
  },
  cover: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    borderRadius: 8,
    height: 420,
    overflow: "hidden",
    padding: 14,
    position: "relative",
  },
  coverArt: {
    aspectRatio: 1200 / 630,
    height: 294,
    maxWidth: 560,
    opacity: 0.92,
    width: "100%",
  },
  coverScrim: {
    bottom: 0,
    backgroundColor: "rgba(18, 12, 8, 0.78)",
    gap: 10,
    left: 0,
    paddingHorizontal: 24,
    paddingVertical: 16,
    position: "absolute",
    right: 0,
    width: "100%",
  },
  coverKicker: {
    color: "#d8b56c",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  coverTitle: {
    color: "#fff8ea",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 39,
    maxWidth: 640,
  },
  coverCopy: {
    color: "#ead9bd",
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 540,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#fff8ea",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#7b5a35",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: "#2d1d12",
    fontSize: 16,
    fontWeight: "800",
  },
  section: {
    gap: 12,
    maxWidth: 900,
    width: "100%",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#24180f",
    fontSize: 22,
    fontWeight: "800",
  },
  storyList: {
    gap: 12,
  },
  storyCard: {
    alignItems: "stretch",
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 170,
    minHeight: 156,
    overflow: "hidden",
  },
  storyCover: {
    aspectRatio: 7 / 10,
    backgroundColor: "#17100b",
    height: 170,
    width: 104,
  },
  storyBody: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 16,
  },
  storyMeta: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
  },
  storyTitle: {
    color: "#24180f",
    fontSize: 20,
    fontWeight: "800",
  },
  storySummary: {
    color: "#594635",
    fontSize: 15,
    lineHeight: 21,
  },
});
