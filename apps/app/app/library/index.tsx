import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, View } from "react-native";
import type { StorySummary } from "@cyoa/stories";
import { useEffect, useState } from "react";

import { AgeGate } from "../../components/account/AgeGate";
import { ContinueReading } from "../../components/library";
import { AppNav } from "../../components/navigation";
import { Text } from "../../components/primitives";
import { ReadingModeChooser } from "../../components/reading/ReadingModeChooser";
import type { ReadingMode } from "../../lib/readingMode";
import { hasRemoteGameApi, listRemotePublishedCreatorSeeds, type RemoteCreatorSeedItem } from "../../lib/gameApi";
import { getStoryCoverSource } from "../../lib/designAssets";
import { useBreakpoint } from "../../lib/responsive";
import { creatorSeedSaveId, listLocalCreatorSeeds, type LocalCreatorSeed } from "../../lib/localCreatorSeeds";
import { guestAuthArgs, useGuestSession, type AgeSelection } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";
import { useNarratorVoice } from "../../hooks/useNarratorVoice";
import { useAppTheme } from "../../theme";

/**
 * Guest shelf / library route. Every color/spacing/typography value
 * resolves through `useAppTheme().tokens` so the page paints correctly in
 * day, night, and sepia. The previous version hardcoded a sepia palette
 * in StyleSheet.create which rendered tan-on-tan when the theme provider
 * was set to Day or Night — most visibly the eyebrow above "Choose a
 * starter adventure." and the `<Text variant="subtitle">Continue
 * reading</Text>` ContinueReading caption.
 *
 * Drift guard: see
 * `apps/app/components/reading/__tests__/themedSurfaces.test.mjs`.
 */
export default function LibraryRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const { tokens } = useAppTheme();
  // Responsive: every story card on the shelf collapses cover+body to a
  // single stacked column on phones (<520px). Without this the title+meta
  // pane has ~211px to work with at 375 viewport — well below the
  // comfortable reading width and the user reports cramped wrap.
  const { isPhone } = useBreakpoint();
  // Library is the other start-a-tale surface (starters + creator seeds).
  // No active save here, so we read the last-used voice and forward it on
  // the createRemoteSave call. Matches the cover-screen flow at app/index.tsx.
  const narrator = useNarratorVoice(null);
  // Reading-modes cleanup — the reader picks how the next starter tale reads
  // (Branching vs Novel) through the shared ReadingModeChooser, matching the
  // cover screen. Replaces the old inline segmented toggle + reveal-on-change
  // caption (the chooser owns the always-visible blurb now). Chosen at create
  // (posture A); the server re-gates Novel on entitlement (dev-force-unlocked
  // locally). Default: branching. `novelMode` stays the local state so the
  // createSave threading below is untouched.
  const [novelMode, setNovelMode] = useState(false);
  const readingMode: ReadingMode = novelMode ? "novel" : "branching";
  const chooseReadingMode = (mode: ReadingMode) => setNovelMode(mode === "novel");
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
    const save = await library.createSave(seed.storyId, "story", seed.title, narrator.voiceId);
    openSave(save.saveId);
  };

  const localOnlyCreatorSeeds = creatorSeeds.filter(
    (seed) => !remoteCreatorSeeds.some((remoteSeed) => remoteSeed.seedId === seed.seedId),
  );
  const hasCreatedSeeds = remoteCreatorSeeds.length > 0 || localOnlyCreatorSeeds.length > 0;

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
      <View
        style={{
          alignItems: "flex-start",
          gap: tokens.spacing.md,
          maxWidth: 900,
          width: "100%",
        }}
      >
        <AppNav current="library" />
        <View>
          <Text
            style={{
              color: tokens.colors.textMuted,
              fontFamily: tokens.typography.families.mono,
              fontWeight: "800",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            Guest shelf
          </Text>
          <Text style={{ marginTop: tokens.spacing.xs }} variant="title">
            Choose a starter adventure.
          </Text>
        </View>
      </View>

      {library.continueSave ? (
        <View style={{ gap: tokens.spacing.sm, maxWidth: 900, width: "100%" }}>
          <ContinueReading
            save={library.continueSave}
            onContinue={(save) => openSave(save.saveId)}
          />
        </View>
      ) : null}

      {/* Reader-authored / in-progress adventures. Previously the library
          only surfaced the SINGLE most-recent save via Continue Reading
          and showed starter templates beneath it — readers with multiple
          seeded saves couldn't see them all and reported "do new stories
          appear?". This section lists every save the reader has on this
          account, newest first, with the reader's authored title (server
          projects save.seedTitle when present, else the story id). */}
      {library.saves.length > 0 ? (
        <View style={{ gap: tokens.spacing.sm, maxWidth: 900, width: "100%" }}>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              Your adventures
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/creator")}>
              <Text tone="accent" style={{ fontWeight: "800" }} variant="bodySmall">
                Seed a new one
              </Text>
            </Pressable>
          </View>
          <View style={{ gap: tokens.spacing.sm }}>
            {[...library.saves]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((save) => (
                <Pressable
                  accessibilityRole="button"
                  key={save.saveId}
                  onPress={() => openSave(save.saveId)}
                  style={{
                    backgroundColor: tokens.colors.surface,
                    borderColor: tokens.colors.border,
                    borderRadius: tokens.radii.sm,
                    borderWidth: tokens.borderWidths.hairline,
                    flexDirection: isPhone ? "column" : "row",
                    gap: tokens.spacing.sm,
                    // No fixed height on phones — stacked layout sizes to
                    // content so long titles don't get truncated.
                    minHeight: 164,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      alignItems: "center",
                      backgroundColor: tokens.colors.text,
                      justifyContent: "center",
                      // Phone: stripe across full width as a banner.
                      minHeight: isPhone ? 48 : undefined,
                      paddingVertical: isPhone ? tokens.spacing.md : 0,
                      width: isPhone ? "100%" : 128,
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
                      variant="body"
                    >
                      {save.status === "active" ? "Read" : save.status === "dead" ? "Died" : "Ended"}
                    </Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      gap: tokens.spacing.sm,
                      justifyContent: "center",
                      padding: tokens.spacing.md,
                    }}
                  >
                    <View
                      style={{
                        alignItems: "center",
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: tokens.spacing.sm,
                        justifyContent: "space-between",
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
                        {`Turn ${save.turnNumber}`}
                      </Text>
                      <Text muted style={{ fontWeight: "700" }} variant="caption">
                        {save.mode}
                      </Text>
                    </View>
                    <Text style={{ fontWeight: "800" }} variant="subtitle">
                      {save.title}
                    </Text>
                    <Text muted variant="bodySmall">
                      {save.storyId === "open-canvas" ? "Seeded adventure" : save.storyId}
                    </Text>
                    <Text
                      tone="accent"
                      style={{ fontWeight: "800", marginTop: tokens.spacing.xs }}
                      variant="bodySmall"
                    >
                      {save.status === "active" ? "Continue" : "Re-read"}
                    </Text>
                  </View>
                </Pressable>
              ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: tokens.spacing.sm, maxWidth: 900, width: "100%" }}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: tokens.spacing.sm,
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontWeight: "800" }} variant="subtitle">
            Starters
          </Text>
        </View>
        {/* Reading-modes cleanup — the shared two-option chooser with its
            always-visible blurbs replaces the compact segmented toggle +
            reveal-on-change caption. Applies to the tale you start next. */}
        <ReadingModeChooser onChange={chooseReadingMode} value={readingMode} />
        <View style={{ gap: tokens.spacing.sm }}>
          {library.starterStories.map((story: StorySummary) => (
            <Pressable
              accessibilityRole="button"
              key={story.id}
              onPress={async () => {
                const save: LibrarySave = await library.createSave(
                  story.id,
                  "story",
                  undefined,
                  narrator.voiceId,
                  undefined,
                  { readingMode: novelMode ? "novel" : "branching" },
                );
                openSave(save.saveId);
              }}
              style={{
                backgroundColor: tokens.colors.surface,
                borderColor: tokens.colors.border,
                borderRadius: tokens.radii.sm,
                borderWidth: tokens.borderWidths.hairline,
                // Horizontal card on every viewport — see landing for
                // rationale. Stacking on phone made each card eat the
                // full screen; a compact row card fits multiple titles
                // above the fold on a 667 px phone.
                flexDirection: "row",
                gap: tokens.spacing.sm,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: tokens.colors.text,
                  borderBottomLeftRadius: tokens.radii.sm,
                  borderBottomRightRadius: 0,
                  borderTopLeftRadius: tokens.radii.sm,
                  borderTopRightRadius: 0,
                  justifyContent: "center",
                  padding: isPhone ? tokens.spacing.xs : tokens.spacing.sm,
                  // Compact slipcase on phone (96 px), original 128 on desktop.
                  width: isPhone ? 96 : 128,
                }}
              >
                <Image
                  accessibilityLabel={`${story.title} cover`}
                  resizeMode="contain"
                  source={getStoryCoverSource(story.id)}
                  // Explicit book-cover dimensions (7:10). Relying on
                  // `aspectRatio` + `width: "100%"` alone let RN-web stretch
                  // the image — and the whole row card — to ~700 px tall.
                  style={{
                    height: isPhone ? 120 : 160,
                    width: isPhone ? 84 : 112,
                  }}
                />
                <View
                  style={{
                    backgroundColor: tokens.colors.overlay,
                    paddingHorizontal: tokens.spacing.sm,
                    paddingVertical: tokens.spacing.xs,
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
                    {story.difficulty}
                  </Text>
                </View>
              </View>
              <View
                style={{
                  flex: 1,
                  gap: tokens.spacing.sm,
                  justifyContent: "center",
                  padding: tokens.spacing.md,
                }}
              >
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: tokens.spacing.sm,
                    justifyContent: "space-between",
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
                    {story.estimatedLength}
                  </Text>
                  <Text muted style={{ fontWeight: "700" }} variant="caption">
                    {story.tone}
                  </Text>
                </View>
                <Text style={{ fontWeight: "800" }} variant="subtitle">
                  {story.title}
                </Text>
                <Text muted variant="bodySmall">
                  {story.summary}
                </Text>
                <Text
                  tone="accent"
                  style={{ fontWeight: "800", marginTop: tokens.spacing.xs }}
                  variant="bodySmall"
                >
                  Launch story
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      {hasCreatedSeeds ? (
        <View style={{ gap: tokens.spacing.sm, maxWidth: 900, width: "100%" }}>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              Created by you
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/creator")}>
              <Text tone="accent" style={{ fontWeight: "800" }} variant="bodySmall">
                New seed
              </Text>
            </Pressable>
          </View>
          <View style={{ gap: tokens.spacing.sm }}>
            {remoteCreatorSeeds.map((seed) => (
              <Pressable
                accessibilityRole="button"
                key={seed.seedId}
                onPress={() => {
                  void openRemoteCreatorSeed(seed);
                }}
                style={{
                  backgroundColor: tokens.colors.surface,
                  borderColor: tokens.colors.border,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.hairline,
                  flexDirection: isPhone ? "column" : "row",
                  gap: tokens.spacing.sm,
                  minHeight: 164,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: tokens.colors.text,
                    justifyContent: "center",
                    minHeight: isPhone ? 48 : undefined,
                    paddingVertical: isPhone ? tokens.spacing.md : 0,
                    width: isPhone ? "100%" : 128,
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
                    variant="body"
                  >
                    Seed
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    gap: tokens.spacing.sm,
                    justifyContent: "center",
                    padding: tokens.spacing.md,
                  }}
                >
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: tokens.spacing.sm,
                      justifyContent: "space-between",
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
                      Published
                    </Text>
                    <Text muted style={{ fontWeight: "700" }} variant="caption">
                      account shelf
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "800" }} variant="subtitle">
                    {seed.title}
                  </Text>
                  <Text muted variant="bodySmall">
                    {seed.opening}
                  </Text>
                  <Text
                    tone="accent"
                    style={{ fontWeight: "800", marginTop: tokens.spacing.xs }}
                    variant="bodySmall"
                  >
                    Launch story
                  </Text>
                </View>
              </Pressable>
            ))}
            {localOnlyCreatorSeeds.map((seed) => (
              <Pressable
                accessibilityRole="button"
                key={seed.seedId}
                onPress={() => openSave(creatorSeedSaveId(seed.seedId))}
                style={{
                  backgroundColor: tokens.colors.surface,
                  borderColor: tokens.colors.border,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.hairline,
                  flexDirection: isPhone ? "column" : "row",
                  gap: tokens.spacing.sm,
                  minHeight: 164,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: tokens.colors.text,
                    justifyContent: "center",
                    minHeight: isPhone ? 48 : undefined,
                    paddingVertical: isPhone ? tokens.spacing.md : 0,
                    width: isPhone ? "100%" : 128,
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
                    variant="body"
                  >
                    Seed
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    gap: tokens.spacing.sm,
                    justifyContent: "center",
                    padding: tokens.spacing.md,
                  }}
                >
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: tokens.spacing.sm,
                      justifyContent: "space-between",
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
                      Published
                    </Text>
                    <Text muted style={{ fontWeight: "700" }} variant="caption">
                      saved draft
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "800" }} variant="subtitle">
                    {seed.title}
                  </Text>
                  <Text muted variant="bodySmall">
                    {seed.story.nodes[seed.story.startNodeId]?.seed ?? "Open the seed and test the first branch."}
                  </Text>
                  <Text
                    tone="accent"
                    style={{ fontWeight: "800", marginTop: tokens.spacing.xs }}
                    variant="bodySmall"
                  >
                    Read story
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
