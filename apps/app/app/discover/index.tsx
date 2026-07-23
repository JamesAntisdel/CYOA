import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary } from "../../hooks/useLibrary";
import { useToast } from "../../hooks/useToast";
import { listCreatorTemplates } from "../../lib/creatorTemplates";
import { useBreakpoint } from "../../lib/responsive";
import {
  listRemoteCommunitySeeds,
  remixRemoteSeed,
  type CommunitySeed,
} from "../../lib/seedShelfApi";
import { useAppTheme } from "../../theme";
import { Button, Chip, Stamp, Surface, Text } from "../../components/primitives";
import { ReadingModeChooser } from "../../components/reading/ReadingModeChooser";
import type { ReadingMode } from "../../lib/readingMode";
import { isIllustratedBookUnlocked } from "../../lib/readerSettingsGroups";

/**
 * Discover route (creator-arc; core-read-loop Req 22.3/22.6, steering product
 * feature 13 — publishing becomes a social act). Three shelves:
 *
 *  1. COMMUNITY SHELF (top): other creators' public seeds from the real
 *     `creatorFunctions:listPublishedPublic` query — launchable as a fresh
 *     run by any account/guest, remixable when the creator allows it.
 *  2. The published-tales archive + the reader's own publishable saves
 *     (existing interim surface, kept as secondary sections).
 *  3. TEMPLATES: "begin from a template" cards built from the bundled starter
 *     stubs; each prefills the creator form (/creator?template=<id>) so the
 *     form starts from a chosen premise or blank — never sample text.
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

  // Community seed shelf: undefined = loading, null = unreachable (retry),
  // [] = genuinely empty shelf.
  const [seeds, setSeeds] = useState<CommunitySeed[] | null | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [shelfNonce, setShelfNonce] = useState(0);
  const [busySeedId, setBusySeedId] = useState<string | null>(null);
  const templates = useMemo(() => listCreatorTemplates(), []);
  // Reading-modes cleanup — the reader picks how the community seed they begin
  // next reads (Branching vs Novel) through the shared ReadingModeChooser,
  // matching the cover screen. Replaces the old inline segmented toggle +
  // reveal-on-change caption (the chooser owns the always-visible blurb now).
  // Chosen at create (posture A); the server re-gates Novel on entitlement
  // (dev-force-unlocked locally). Default: branching. `novelMode` stays the
  // local state so the launchSeed createSave threading is untouched.
  const [novelMode, setNovelMode] = useState(false);
  const readingMode: ReadingMode = novelMode ? "novel" : "branching";
  const chooseReadingMode = (mode: ReadingMode) => setNovelMode(mode === "novel");
  // Reading-modes cleanup — Novel is a Pro mode. Same pro-media gate the rest
  // of the app uses (dev-force flag OR active pro/unlimited) so a non-Pro
  // reader who taps Novel routes to the paywall instead of a silent downgrade.
  const novelUnlocked = isIllustratedBookUnlocked(profile);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const page = await listRemoteCommunitySeeds({
        ...(guest.session ? { accountId: guest.session.accountId } : {}),
        ...guestAuthArgs(),
      });
      if (cancelled) return;
      if (!page) {
        setSeeds(null);
        setNextCursor(null);
        return;
      }
      setSeeds(page.seeds);
      setNextCursor(page.nextCursor);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [guest.session, shelfNonce]);

  const loadMoreSeeds = async () => {
    if (nextCursor === null) return;
    const page = await listRemoteCommunitySeeds({
      ...(guest.session ? { accountId: guest.session.accountId } : {}),
      ...guestAuthArgs(),
      cursor: nextCursor,
    });
    if (!page) {
      push({ message: "The shelf did not answer. Try again.", tone: "warning" });
      return;
    }
    setSeeds((current) => [...(current ?? []), ...page.seeds]);
    setNextCursor(page.nextCursor);
  };

  /** Launch a fresh run of another creator's public seed (Req 22.3 — this is
   * what feeds the creator dashboard's external-play attribution). */
  const launchSeed = async (seed: CommunitySeed) => {
    if (!guest.session) {
      push({ message: "Start a session on the cover page first.", tone: "warning" });
      router.push("/");
      return;
    }
    setBusySeedId(seed.seedId);
    try {
      const save = await library.createSave(
        seed.storyId,
        "story",
        seed.title,
        undefined,
        undefined,
        { readingMode: novelMode ? "novel" : "branching" },
      );
      router.push(`/read/${save.saveId}`);
    } catch (error) {
      push({
        message: error instanceof Error ? error.message : "That seed would not open.",
        tone: "warning",
      });
    } finally {
      setBusySeedId(null);
    }
  };

  /** Copy a public seed into the reader's own drafts, credited to the source,
   * then land in the creator form with the fresh draft loaded. */
  const remixSeed = async (seed: CommunitySeed) => {
    if (!guest.session) {
      push({ message: "Start a session on the cover page first.", tone: "warning" });
      router.push("/");
      return;
    }
    setBusySeedId(seed.seedId);
    try {
      const remixed = await remixRemoteSeed({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        seedId: seed.seedId,
      });
      if (!remixed) {
        push({ message: "Remix is unavailable for this seed.", tone: "warning" });
        return;
      }
      push({ message: `Remix drafted from "${seed.title}".`, tone: "success" });
      router.push(`/creator?load=${remixed.seedId}`);
    } finally {
      setBusySeedId(null);
    }
  };

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

  // No public-tale Convex query exists yet; the tales shelf is empty by design.
  // When that query lands, replace this constant with a useQuery() call.
  const tales: DiscoverTale[] = useMemo(() => [], []);

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
            <Stamp>the community shelf</Stamp>
            <Text variant="display">Discover</Text>
            <Text muted variant="body">
              Seeds other creators have shelved for anyone to play. Begin one as a fresh
              run, or remix it into a draft of your own.
            </Text>
            {/* Reading-modes cleanup — the shared two-option chooser with its
                always-visible blurbs replaces the compact segmented toggle +
                reveal-on-change caption. Applies to the seed you begin next. */}
            <ReadingModeChooser
              isPro={novelUnlocked}
              onChange={chooseReadingMode}
              onNovelLocked={() => router.push("/paywall?reason=pro_media")}
              value={readingMode}
            />
          </View>

          {seeds === undefined ? (
            <Text accessibilityLabel="Community shelf loading" muted>
              Dusting off the shelf…
            </Text>
          ) : seeds === null ? (
            <Surface padded>
              <View style={{ gap: tokens.spacing.sm }}>
                <Text muted>The shelf did not answer.</Text>
                <View style={{ alignSelf: "flex-start" }}>
                  <Button onPress={() => setShelfNonce((nonce) => nonce + 1)}>Try again</Button>
                </View>
              </View>
            </Surface>
          ) : seeds.length === 0 ? (
            <EmptyState
              body="No seed sits on the community shelf yet — but the desk below is open. Begin from a template, carry one of your own finished tales onto the shelf, or seed something new and publish it here for the next reader."
              kicker="the community shelf"
              title="The shelf grows as creators publish."
            />
          ) : (
            <View style={{ gap: tokens.spacing.md }}>
              {seeds.map((seed) => (
                <Surface key={seed.seedId} style={{ gap: tokens.spacing.md, padding: tokens.spacing.lg }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                    <Stamp>community seed</Stamp>
                    {seed.isMature ? <Stamp>mature</Stamp> : null}
                  </View>
                  <Text variant="subtitle">{seed.title}</Text>
                  <Text muted variant="bodySmall">
                    {seed.synopsis ?? seed.opening}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                    <Chip>{`kept by ${seed.ownerHandle}`}</Chip>
                    {seed.tone ? <Chip>{seed.tone}</Chip> : null}
                    {seed.remixOfTitle ? <Chip variant="muted">{`remix of ${seed.remixOfTitle}`}</Chip> : null}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                    <Button
                      accessibilityLabel={`Begin ${seed.title}`}
                      disabled={busySeedId !== null}
                      onPress={() => launchSeed(seed)}
                      variant="primary"
                    >
                      Begin this adventure
                    </Button>
                    {seed.forkPolicy === "allowed" ? (
                      <Button
                        accessibilityLabel={`Remix ${seed.title}`}
                        disabled={busySeedId !== null}
                        onPress={() => remixSeed(seed)}
                        variant="ghost"
                      >
                        Remix
                      </Button>
                    ) : null}
                  </View>
                </Surface>
              ))}
              {nextCursor !== null ? (
                <View style={{ alignSelf: "flex-start" }}>
                  <Button onPress={() => void loadMoreSeeds()} variant="ghost">
                    Older seeds
                  </Button>
                </View>
              ) : null}
            </View>
          )}

          {/* Cold-start ordering (panel-review-2 merged shelf fix): the two
              surfaces a fresh visitor can actually ACT on — begin-from-a-template
              and their own finished tales ready to publish — sit directly under
              the community shelf, ABOVE the always-empty public archive. On a
              fresh deployment the flagship social surface leads with something to
              do instead of a wall of empty states. */}
          <View style={{ gap: tokens.spacing.md }}>
            <View style={{ gap: tokens.spacing.sm }}>
              <Stamp>begin from a template</Stamp>
              <Text variant="title">Seed something of your own.</Text>
              <Text muted variant="bodySmall">
                Start the creator desk from a bundled premise — or from a blank page. Nothing
                is prefilled that you did not choose.
              </Text>
            </View>
            {templates.map((template) => (
              <Surface key={template.id} style={{ gap: tokens.spacing.sm, padding: tokens.spacing.lg }}>
                <Text variant="subtitle">{template.title}</Text>
                <Text muted variant="bodySmall">{template.summary}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                  <Chip>{template.tone}</Chip>
                </View>
                <View style={{ alignSelf: "flex-start" }}>
                  <Button
                    accessibilityLabel={`Begin from template ${template.title}`}
                    onPress={() => router.push(`/creator?template=${template.id}`)}
                  >
                    Begin from this template
                  </Button>
                </View>
              </Surface>
            ))}
            <View style={{ alignSelf: "flex-start" }}>
              <Button onPress={() => router.push("/creator")} variant="ghost">
                Start from a blank page
              </Button>
            </View>
          </View>

          {/* The reader's own finished tales, ready to carry onto the shelf —
              the near end of the publish loop, surfaced above the (currently
              always-empty) public archive so a fresh account sees its own
              publishable work before a wall of empty states. */}
          <PublishableShelf
            onPublish={(saveId) => router.push(`/publish/${saveId}`)}
            saves={library.saves}
          />

          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>the archive</Stamp>
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
