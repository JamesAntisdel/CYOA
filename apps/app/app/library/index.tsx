import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";
import { useEffect, useState } from "react";

import { AgeGate } from "../../components/account/AgeGate";
import { AppNav } from "../../components/navigation";
import { hasRemoteGameApi, listRemotePublishedCreatorSeeds, type RemoteCreatorSeedItem } from "../../lib/gameApi";
import { getStoryCoverSource } from "../../lib/designAssets";
import { creatorSeedSaveId, listLocalCreatorSeeds, type LocalCreatorSeed } from "../../lib/localCreatorSeeds";
import { guestAuthArgs, useGuestSession, type AgeSelection } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";

export default function LibraryRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const [creatorSeeds, setCreatorSeeds] = useState<LocalCreatorSeed[]>([]);
  const [remoteCreatorSeeds, setRemoteCreatorSeeds] = useState<RemoteCreatorSeedItem[]>([]);

  useEffect(() => {
    setCreatorSeeds(listLocalCreatorSeeds().filter((seed) => seed.status === "published"));
    if (!guest.session || !hasRemoteGameApi()) {
      setRemoteCreatorSeeds([]);
      return;
    }

    let cancelled = false;
    void listRemotePublishedCreatorSeeds({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
    }).then((seeds) => {
      if (!cancelled) setRemoteCreatorSeeds(seeds ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [guest.session]);

  const handleAgeSubmit = (selection: AgeSelection) => {
    void guest.createGuestSession(selection);
  };

  const openSave = (saveId: string) => {
    router.push(`/read/${saveId}`);
  };

  const openRemoteCreatorSeed = async (seed: RemoteCreatorSeedItem) => {
    const save = await library.createSave(seed.storyId, "story", seed.title);
    openSave(save.saveId);
  };

  const localOnlyCreatorSeeds = creatorSeeds.filter(
    (seed) => !remoteCreatorSeeds.some((remoteSeed) => remoteSeed.seedId === seed.seedId),
  );
  const hasCreatedSeeds = remoteCreatorSeeds.length > 0 || localOnlyCreatorSeeds.length > 0;

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
        <AppNav current="library" />
        <View>
          <Text style={styles.eyebrow}>Guest shelf</Text>
          <Text style={styles.title}>Choose a starter adventure.</Text>
        </View>
      </View>

      {library.continueSave ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Continue reading</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => openSave(library.continueSave!.saveId)}
            style={styles.continueCard}
          >
            <Image
              accessibilityLabel={`${library.continueSave.title} cover`}
              resizeMode="contain"
              source={getStoryCoverSource(library.continueSave.storyId)}
              style={styles.continueCover}
            />
            <View style={styles.continueBody}>
              <Text style={styles.continueTitle}>{library.continueSave.title}</Text>
              <Text style={styles.continueSummary}>
                Turn {library.continueSave.turnNumber} · Story mode
              </Text>
            </View>
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
              onPress={async () => {
                const save: LibrarySave = await library.createSave(story.id);
                openSave(save.saveId);
              }}
              style={styles.storyCard}
            >
              <View style={styles.storyCover}>
                <Image
                  accessibilityLabel={`${story.title} cover`}
                  resizeMode="contain"
                  source={getStoryCoverSource(story.id)}
                  style={styles.storyCoverImage}
                />
                <View style={styles.storyBadge}>
                  <Text style={styles.storyBadgeText}>{story.difficulty}</Text>
                </View>
              </View>
              <View style={styles.storyBody}>
                <View style={styles.storyHeader}>
                  <Text style={styles.storyMeta}>{story.estimatedLength}</Text>
                  <Text style={styles.storyTone}>{story.tone}</Text>
                </View>
                <Text style={styles.storyTitle}>{story.title}</Text>
                <Text style={styles.storySummary}>{story.summary}</Text>
                <Text style={styles.launchText}>Launch story</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      {hasCreatedSeeds ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Created by you</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/creator")}>
              <Text style={styles.textButton}>New seed</Text>
            </Pressable>
          </View>
          <View style={styles.storyList}>
            {remoteCreatorSeeds.map((seed) => (
              <Pressable
                accessibilityRole="button"
                key={seed.seedId}
                onPress={() => {
                  void openRemoteCreatorSeed(seed);
                }}
                style={[styles.storyCard, styles.creatorCard]}
              >
                <View style={styles.creatorMark}>
                  <Text style={styles.creatorMarkText}>Seed</Text>
                </View>
                <View style={styles.storyBody}>
                  <View style={styles.storyHeader}>
                    <Text style={styles.storyMeta}>Published</Text>
                    <Text style={styles.storyTone}>account shelf</Text>
                  </View>
                  <Text style={styles.storyTitle}>{seed.title}</Text>
                  <Text style={styles.storySummary}>{seed.opening}</Text>
                  <Text style={styles.launchText}>Launch story</Text>
                </View>
              </Pressable>
            ))}
            {localOnlyCreatorSeeds.map((seed) => (
              <Pressable
                accessibilityRole="button"
                key={seed.seedId}
                onPress={() => openSave(creatorSeedSaveId(seed.seedId))}
                style={[styles.storyCard, styles.creatorCard]}
              >
                <View style={styles.creatorMark}>
                  <Text style={styles.creatorMarkText}>Seed</Text>
                </View>
                <View style={styles.storyBody}>
                  <View style={styles.storyHeader}>
                    <Text style={styles.storyMeta}>Published</Text>
                    <Text style={styles.storyTone}>saved draft</Text>
                  </View>
                  <Text style={styles.storyTitle}>{seed.title}</Text>
                  <Text style={styles.storySummary}>
                    {seed.story.nodes[seed.story.startNodeId]?.seed ?? "Open the seed and test the first branch."}
                  </Text>
                  <Text style={styles.launchText}>Read story</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
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
    gap: 16,
    maxWidth: 900,
    width: "100%",
  },
  headerTitleRow: {
    alignItems: "flex-start",
    flex: 1,
    flexDirection: "row",
    gap: 12,
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
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  continueCard: {
    alignItems: "stretch",
    backgroundColor: "#2d1d12",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 150,
    minHeight: 132,
    overflow: "hidden",
  },
  continueCover: {
    aspectRatio: 7 / 10,
    backgroundColor: "#17100b",
    height: 150,
    width: 92,
  },
  continueBody: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 16,
  },
  continueTitle: {
    color: "#fff8ea",
    fontSize: 20,
    fontWeight: "800",
  },
  continueSummary: {
    color: "#ead9bd",
    fontSize: 15,
    lineHeight: 21,
  },
  storyList: {
    gap: 12,
  },
  storyCard: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 220,
    minHeight: 186,
    overflow: "hidden",
  },
  creatorCard: {
    height: 178,
    minHeight: 164,
  },
  creatorMark: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    justifyContent: "center",
    width: 128,
  },
  creatorMarkText: {
    color: "#e6ca85",
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  storyCover: {
    alignItems: "center",
    backgroundColor: "#17100b",
    borderBottomLeftRadius: 8,
    borderTopLeftRadius: 8,
    height: 220,
    justifyContent: "center",
    padding: 8,
    width: 128,
  },
  storyCoverImage: {
    aspectRatio: 7 / 10,
    width: "100%",
  },
  storyBadge: {
    backgroundColor: "rgba(19, 17, 13, 0.74)",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  storyBadgeText: {
    color: "#e6ca85",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  storyBody: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
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
