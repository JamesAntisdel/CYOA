import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";

import { AgeGate } from "../../components/account/AgeGate";
import { useGuestSession, type AgeSelection } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";

export default function LibraryRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);

  const handleAgeSubmit = (selection: AgeSelection) => {
    guest.createGuestSession(selection);
  };

  const openSave = (saveId: string) => {
    router.push(`/read/${saveId}`);
  };

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
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Guest shelf</Text>
          <Text style={styles.title}>Choose a starter adventure.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push("/")}>
          <Text style={styles.textButton}>Cover</Text>
        </Pressable>
      </View>

      {library.continueSave ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Continue reading</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => openSave(library.continueSave!.saveId)}
            style={styles.continueCard}
          >
            <Text style={styles.storyTitle}>{library.continueSave.title}</Text>
            <Text style={styles.storySummary}>
              Turn {library.continueSave.turnNumber} · Story mode
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Starters</Text>
        <View style={styles.storyList}>
          {library.starterStories.map((story: StorySummary) => (
            <Pressable
              accessibilityRole="button"
              key={story.id}
              onPress={() => {
                const save: LibrarySave = library.createSave(story.id);
                openSave(save.saveId);
              }}
              style={styles.storyCard}
            >
              <View style={styles.storyHeader}>
                <Text style={styles.storyMeta}>
                  {story.difficulty.toUpperCase()} · {story.estimatedLength}
                </Text>
                <Text style={styles.storyTone}>{story.tone}</Text>
              </View>
              <Text style={styles.storyTitle}>{story.title}</Text>
              <Text style={styles.storySummary}>{story.summary}</Text>
              <Text style={styles.launchText}>Launch story</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    maxWidth: 900,
    width: "100%",
  },
  eyebrow: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#24180f",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
    marginTop: 4,
  },
  textButton: {
    color: "#7b3f20",
    fontSize: 15,
    fontWeight: "800",
  },
  section: {
    gap: 12,
    maxWidth: 900,
    width: "100%",
  },
  sectionTitle: {
    color: "#24180f",
    fontSize: 20,
    fontWeight: "800",
  },
  continueCard: {
    backgroundColor: "#2d1d12",
    gap: 8,
    padding: 16,
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
  storyHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  storyMeta: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
  },
  storyTone: {
    color: "#594635",
    fontSize: 12,
    fontWeight: "700",
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
  launchText: {
    color: "#7b3f20",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 4,
  },
});
