import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";

import { AgeGate } from "../components/account/AgeGate";
import { getTutorialStory, useLibrary, type LibrarySave } from "../hooks/useLibrary";
import { useGuestSession, type AgeSelection } from "../hooks/useGuestSession";

export default function IndexRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const tutorialStory = getTutorialStory(library.starterStories);

  const handleAgeSubmit = (selection: AgeSelection) => {
    guest.createGuestSession(selection);
  };

  const openSave = (saveId: string) => {
    router.push(`/read/${saveId}`);
  };

  const launchTutorial = () => {
    const save = library.launchTutorialSave();
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
        <View style={styles.brandRow}>
          <Text style={styles.brand}>The Unwritten</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/library")}>
            <Text style={styles.textButton}>Library</Text>
          </Pressable>
        </View>

        <View style={styles.cover}>
          <Text style={styles.coverKicker}>Chapter Zero</Text>
          <Text style={styles.coverTitle}>A living book waits at the threshold.</Text>
          <Text style={styles.coverCopy}>
            Start as a guest. Sign up can wait until the tale is worth keeping.
          </Text>
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
              onPress={() => {
                const save: LibrarySave = library.createSave(story.id);
                openSave(save.saveId);
              }}
              style={styles.storyCard}
            >
              <Text style={styles.storyMeta}>
                {story.difficulty.toUpperCase()} · {story.estimatedLength}
              </Text>
              <Text style={styles.storyTitle}>{story.title}</Text>
              <Text style={styles.storySummary}>{story.summary}</Text>
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
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brand: {
    color: "#24180f",
    fontSize: 22,
    fontWeight: "800",
  },
  textButton: {
    color: "#7b3f20",
    fontSize: 15,
    fontWeight: "700",
  },
  cover: {
    backgroundColor: "#2d1d12",
    minHeight: 320,
    justifyContent: "flex-end",
    padding: 24,
    gap: 10,
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
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderWidth: 1,
    gap: 8,
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
