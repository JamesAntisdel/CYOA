import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Story } from "@cyoa/engine";
import { OPEN_STARTER_ID } from "@cyoa/stories";

import { SeedStoryFlow, SeedToneSelector, type SeedTone } from "../../components/creator";
import { AppNav } from "../../components/navigation";
import { Button, Chip, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { convexClient } from "../../lib/convex";
import { convexHttp } from "../../lib/convexHttp";
import { templateFormValues } from "../../lib/creatorTemplates";
import { createRemoteCreatorDraft, publishRemoteCreatorSeed } from "../../lib/gameApi";
import { listLocalCreatorSeeds, saveLocalCreatorSeed } from "../../lib/localCreatorSeeds";
import { useBreakpoint } from "../../lib/responsive";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary } from "../../hooks/useLibrary";
import { useNarratorVoice } from "../../hooks/useNarratorVoice";
import { useAppTheme } from "../../theme";

type CreatorSeedStatus = "draft" | "published" | "archived";

/** Form fields the custom-seed builder exposes; `general` catches issues on
 * story parts the simple form doesn't edit (ending nodes, version, …). */
type CreatorFormField = "title" | "opening" | "carefulChoice" | "boldChoice" | "general";

type SeedIssue = { path: string; message: string; kind?: "structure" | "safety" };

/** Non-blocking lint advisory from `creatorFunctions:validateSeed` (creator-arc
 * publish gate: errors block, warnings surface with confirmation copy). */
type SeedAdvisory = { path: string; message: string; severity: "warning" | "info" };

type ShelfSeed = {
  seedId: string;
  title: string;
  status: CreatorSeedStatus;
  story: Story;
  updatedAt: number;
  source: "remote" | "local";
};

// ---------------------------------------------------------------------------
// Remote calls for the creator iteration loop. These live here (not in
// gameApi.ts) because the creator route is their only consumer; they use the
// same convexHttp transport + convexClient availability gate as gameApi.
// ---------------------------------------------------------------------------

async function updateRemoteCreatorDraft(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
  title: string;
  story: Story;
}): Promise<{ seedId: string; seed: { status: CreatorSeedStatus } } | null> {
  if (!convexClient) return null;
  return convexHttp("mutation", "creatorFunctions:updateDraft", input as unknown as Record<string, unknown>);
}

async function validateRemoteCreatorSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  story: Story;
}): Promise<{ valid: boolean; issues: SeedIssue[]; advisories?: SeedAdvisory[] } | null> {
  if (!convexClient) return null;
  return convexHttp("query", "creatorFunctions:validateSeed", input as unknown as Record<string, unknown>);
}

async function listRemoteCreatorSeeds(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<Array<{ _id: string; title: string; status: CreatorSeedStatus; story: Story; updatedAt: number }> | null> {
  if (!convexClient) return null;
  return convexHttp("query", "creatorFunctions:listMine", input as unknown as Record<string, unknown>);
}

async function archiveRemoteCreatorSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
}): Promise<{ seedId: string } | null> {
  if (!convexClient) return null;
  return convexHttp("mutation", "creatorFunctions:archive", input as unknown as Record<string, unknown>);
}

/**
 * Map a validation-issue path (dotted story addressing from
 * `creatorFunctions:validateSeed`, e.g. `nodes.start.seed`) onto the form
 * field that produced that part of the generated story. `buildCreatorStory`
 * derives `id`/`version`/node title from the title field, so those paths
 * route there; anything outside the four editable fields lands in `general`.
 */
export function fieldForIssuePath(path: string): CreatorFormField {
  if (path === "title" || path === "id" || path === "version" || path === "nodes.start.title") {
    return "title";
  }
  if (path === "nodes.start.seed") return "opening";
  if (path.startsWith("nodes.start.choices.careful.")) return "carefulChoice";
  if (path.startsWith("nodes.start.choices.bold.")) return "boldChoice";
  return "general";
}

export function groupIssuesByField(issues: SeedIssue[]): Partial<Record<CreatorFormField, string[]>> {
  const grouped: Partial<Record<CreatorFormField, string[]>> = {};
  for (const issue of issues) {
    const field = fieldForIssuePath(issue.path);
    // General-bucket issues keep their path — without it "Ending is not
    // registered" gives the author nothing to act on.
    const message = field === "general" ? `${issue.path}: ${issue.message}` : issue.message;
    (grouped[field] ??= []).push(message);
  }
  return grouped;
}

/** Remote rows win over local mirrors of the same seedId; archived seeds drop
 * off the shelf; newest first. */
export function mergeDraftShelf(remote: ShelfSeed[], local: ShelfSeed[]): ShelfSeed[] {
  const seen = new Set(remote.map((item) => item.seedId));
  return [...remote, ...local.filter((item) => !seen.has(item.seedId))]
    .filter((item) => item.status !== "archived")
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Recover the four form fields from a saved story so the shelf can load a
 * draft back into the builder. Inverse of `buildCreatorStory`. */
export function formValuesFromStory(story: Story): {
  title: string;
  opening: string;
  carefulChoice: string;
  boldChoice: string;
} {
  const start = story.nodes[story.startNodeId];
  return {
    title: story.title,
    opening: start?.seed ?? "",
    carefulChoice: start?.choices[0]?.label ?? "",
    boldChoice: start?.choices[1]?.label ?? "",
  };
}

export default function CreatorRoute() {
  const router = useRouter();
  // ?template=<stub id> prefiils the form from a chosen starter stub;
  // ?load=<seedId> auto-loads a drafts-shelf seed (the Discover remix flow
  // lands here with the freshly credited draft).
  const params = useLocalSearchParams<{ template?: string; load?: string }>();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  // Story-engagement Wave 3 (R12.2): the account's owned keepsakes feed the
  // new-story KeepsakePicker inside SeedStoryFlow.
  const { keepsakes } = useAccountProfile();
  // Creator route also launches starters via SeedStoryFlow → forward the
  // reader's pinned voice so the save record gets a voiceId at create time.
  const narrator = useNarratorVoice(null);
  const { tokens } = useAppTheme();
  // Phone shrinks the page-edge padding so the form gets the full viewport.
  // Default ScrollView padding (spacing.xl ≈ 24) is generous on desktop but
  // wastes ~48px on phones, cramping inputs that already have their own
  // borderWidth + padding.
  const { isPhone } = useBreakpoint();
  // The form starts from a CHOSEN template (?template=) or blank — never from
  // prefilled sample text (the old "Lantern Market" default polluted drafts
  // saved without edits). `templateFormValues` returns blanks for unknown ids.
  const initialForm = useMemo(
    () => templateFormValues(typeof params.template === "string" ? params.template : null),
    // Deliberately locked to the mount-time param: later param churn must not
    // clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [title, setTitle] = useState(initialForm.title);
  const [opening, setOpening] = useState(initialForm.opening);
  const [carefulChoice, setCarefulChoice] = useState(initialForm.carefulChoice);
  const [boldChoice, setBoldChoice] = useState(initialForm.boldChoice);
  const [seedId, setSeedId] = useState<string | null>(null);
  // Tracks the loaded/saved seed's lifecycle so saveDraft knows whether the
  // current seedId is an updatable remote draft (published/archived seeds are
  // immutable — saving from one forks a fresh draft).
  const [seedStatus, setSeedStatus] = useState<CreatorSeedStatus | null>(null);
  const [publishedSeedId, setPublishedSeedId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to save a draft.");
  const [busy, setBusy] = useState(false);
  // Per-field validation/safety issues from creatorFunctions:validateSeed,
  // rendered inline next to the inputs they belong to.
  const [fieldIssues, setFieldIssues] = useState<Partial<Record<CreatorFormField, string[]>>>({});
  const [shelf, setShelf] = useState<ShelfSeed[]>([]);
  const [shelfNonce, setShelfNonce] = useState(0);
  // Publish panel (creator-arc, Req 22.6): metadata mirroring the tale-publish
  // form (synopsis / visibility / remix policy + tone), plus the non-blocking
  // lint advisories surfaced for confirmation before publish.
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [synopsis, setSynopsis] = useState("");
  const [publishTone, setPublishTone] = useState<SeedTone | null>(null);
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [remixAllowed, setRemixAllowed] = useState(true);
  const [advisories, setAdvisories] = useState<SeedAdvisory[]>([]);
  // Drafts-shelf seed to auto-load once the shelf arrives (?load=<seedId>).
  const [pendingLoad, setPendingLoad] = useState<string | null>(
    typeof params.load === "string" && params.load.length > 0 ? params.load : null,
  );
  const story = useMemo(
    () => buildCreatorStory({ title, opening, carefulChoice, boldChoice }),
    [boldChoice, carefulChoice, opening, title],
  );

  // Drafts shelf: remote seeds from creatorFunctions:listMine merged with
  // device-local (`local_`) fallback drafts. Re-runs after every save/archive
  // via shelfNonce.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const local: ShelfSeed[] = listLocalCreatorSeeds()
        .filter((seed) => seed.seedId.startsWith("local_"))
        .map((seed) => ({
          seedId: seed.seedId,
          title: seed.title,
          status: seed.status,
          story: seed.story,
          updatedAt: seed.updatedAt,
          source: "local" as const,
        }));
      let remote: ShelfSeed[] = [];
      if (guest.session) {
        const rows = await listRemoteCreatorSeeds({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
        });
        remote = (rows ?? []).map((row) => ({
          seedId: row._id,
          title: row.title,
          status: row.status,
          story: row.story,
          updatedAt: row.updatedAt,
          source: "remote" as const,
        }));
      }
      if (!cancelled) setShelf(mergeDraftShelf(remote, local));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [guest.session, shelfNonce]);

  const refreshShelf = () => setShelfNonce((nonce) => nonce + 1);

  /** Pre-flight the story through the structured validator. Returns true when
   * saving may proceed; on issues, paints them next to their fields. A null
   * response (offline / no Convex) lets the local-draft fallback proceed. */
  const validateBeforeSave = async (accountId: string): Promise<boolean> => {
    const validation = await validateRemoteCreatorSeed({ accountId, ...guestAuthArgs(), story });
    if (validation && !validation.valid) {
      setFieldIssues(groupIssuesByField(validation.issues));
      setStatus("Fix the highlighted fields before saving.");
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!guest.session) {
      setStatus("Start a session before saving drafts.");
      return;
    }
    setBusy(true);
    setFieldIssues({});
    try {
      if (!(await validateBeforeSave(guest.session.accountId))) return;

      // Update the current remote draft in place; only create a new row when
      // there is nothing updatable (first save, local-only draft, or the
      // loaded seed is published/archived).
      const updatableDraftId =
        seedId && !seedId.startsWith("local_") && seedStatus === "draft" ? seedId : null;
      let remote = updatableDraftId
        ? await updateRemoteCreatorDraft({
            accountId: guest.session.accountId,
            ...guestAuthArgs(),
            seedId: updatableDraftId,
            title,
            story,
          })
        : null;
      const updatedExisting = remote !== null;
      if (!remote) {
        remote = await createRemoteCreatorDraft({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          title,
          story,
        });
      }
      if (remote) {
        setSeedId(remote.seedId);
        setSeedStatus("draft");
        saveLocalCreatorSeed({
          seedId: remote.seedId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus(updatedExisting ? "Draft updated." : "Draft saved.");
        refreshShelf();
      } else {
        const localId = `local_${story.id}`;
        setSeedId(localId);
        setSeedStatus("draft");
        saveLocalCreatorSeed({
          seedId: localId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Draft saved on this device.");
        refreshShelf();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_draft_failed");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Step 1 of publishing: validate (blocking errors paint their fields), pull
   * the non-blocking lint advisories, and open the metadata panel. The actual
   * publish happens in `publishSeed` once the creator confirms.
   */
  const openPublishPanel = async () => {
    if (!guest.session) {
      setStatus("Start a session before publishing.");
      return;
    }
    setBusy(true);
    setFieldIssues({});
    try {
      const validation = await validateRemoteCreatorSeed({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        story,
      });
      if (validation && !validation.valid) {
        setFieldIssues(groupIssuesByField(validation.issues));
        setStatus("Fix the highlighted fields before publishing.");
        return;
      }
      setAdvisories(validation?.advisories ?? []);
      // Default the shelf tone to the reader-facing SEED_TONES id when the
      // creator hasn't picked one yet — left null so the chip stays optional.
      setPublishPanelOpen(true);
      setStatus("Choose how this seed sits on the shelf, then confirm.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_publish_failed");
    } finally {
      setBusy(false);
    }
  };

  /** Publish metadata forwarded to `creatorFunctions:publish` (all optional
   * server-side; omitted keys via conditional spread per BC4). */
  const publishMetadataArgs = () => ({
    ...(synopsis.trim().length > 0 ? { synopsis: synopsis.trim() } : {}),
    ...(publishTone ? { tone: publishTone } : {}),
    visibility,
    forkPolicy: (remixAllowed ? "allowed" : "disabled") as "allowed" | "disabled",
  });

  const publishSeed = async () => {
    if (!guest.session) {
      setStatus("Start a session before publishing.");
      return;
    }
    setBusy(true);
    setFieldIssues({});
    try {
      if (!(await validateBeforeSave(guest.session.accountId))) return;

      const draftId = seedId;
      if (!draftId) {
        const remote = await createRemoteCreatorDraft({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          title,
          story,
        });
        if (remote) {
          const published = await publishRemoteCreatorSeed({
            accountId: guest.session.accountId,
            ...guestAuthArgs(),
            seedId: remote.seedId,
            ...publishMetadataArgs(),
          });
          setSeedId(remote.seedId);
          setSeedStatus(published ? "published" : "draft");
          saveLocalCreatorSeed({
            seedId: remote.seedId,
            title,
            story,
            status: published ? "published" : "draft",
            updatedAt: Date.now(),
          });
          if (published) {
            setPublishedSeedId(remote.seedId);
            setPublishPanelOpen(false);
          }
          setStatus(
            published
              ? visibility === "public"
                ? "Seed published to the community shelf."
                : "Seed published (unlisted)."
              : "Draft saved. Publishing is not available yet.",
          );
          refreshShelf();
          return;
        }
        const localId = `local_${story.id}`;
        setSeedId(localId);
        setSeedStatus("draft");
        saveLocalCreatorSeed({
          seedId: localId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Seed saved on this device. Publishing is not available yet.");
        refreshShelf();
        return;
      }

      if (draftId.startsWith("local_")) {
        saveLocalCreatorSeed({
          seedId: draftId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Seed saved on this device. Publishing is not available yet.");
        refreshShelf();
        return;
      }

      // Best-effort: sync the current form into the draft first so publish
      // snapshots what's on screen, not the last-saved revision.
      if (seedStatus === "draft") {
        await updateRemoteCreatorDraft({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          seedId: draftId,
          title,
          story,
        });
      }
      const published = await publishRemoteCreatorSeed({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        seedId: draftId,
        ...publishMetadataArgs(),
      });
      if (published) setSeedStatus("published");
      saveLocalCreatorSeed({
        seedId: draftId,
        title,
        story,
        status: published ? "published" : "draft",
        updatedAt: Date.now(),
      });
      if (published) {
        setPublishedSeedId(draftId);
        setPublishPanelOpen(false);
      }
      setStatus(
        published
          ? visibility === "public"
            ? "Seed published to the community shelf."
            : "Seed published (unlisted)."
          : "Publishing is not available yet.",
      );
      refreshShelf();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_publish_failed");
    } finally {
      setBusy(false);
    }
  };

  const loadShelfSeed = (item: ShelfSeed) => {
    const values = formValuesFromStory(item.story);
    setTitle(values.title);
    setOpening(values.opening);
    setCarefulChoice(values.carefulChoice);
    setBoldChoice(values.boldChoice);
    setSeedId(item.seedId);
    setSeedStatus(item.status);
    setPublishedSeedId(item.status === "published" ? item.seedId : null);
    setFieldIssues({});
    setStatus(`Loaded "${item.title}".`);
  };

  // Auto-load a shelf seed named by ?load= once the drafts shelf arrives
  // (Discover's remix flow routes here with the fresh draft's id).
  useEffect(() => {
    if (!pendingLoad) return;
    const item = shelf.find((entry) => entry.seedId === pendingLoad);
    if (!item) return;
    loadShelfSeed(item);
    setPendingLoad(null);
    // loadShelfSeed is stable-enough (recreated per render but effect-guarded
    // by pendingLoad); shelf is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf, pendingLoad]);

  const archiveShelfSeed = async (item: ShelfSeed) => {
    if (!guest.session || item.source !== "remote") return;
    setBusy(true);
    try {
      const archived = await archiveRemoteCreatorSeed({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        seedId: item.seedId,
      });
      if (archived) {
        if (seedId === item.seedId) {
          setSeedId(null);
          setSeedStatus(null);
          setPublishedSeedId(null);
        }
        setStatus(`Archived "${item.title}".`);
        refreshShelf();
      } else {
        setStatus("Archive is not available right now.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_archive_failed");
    } finally {
      setBusy(false);
    }
  };

  const inputBorderColor = (field: CreatorFormField) =>
    fieldIssues[field]?.length ? tokens.colors.danger : tokens.colors.borderMuted;

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 940, padding: isPhone ? tokens.spacing.md : tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <AppNav current="creator" />
          <View style={{ gap: tokens.spacing.sm, maxWidth: 680 }}>
            <Stamp>creator</Stamp>
            <Text variant="title">Seed an adventure</Text>
            <Text muted>Author an opening and a launchable rule seed.</Text>
          </View>

          <SeedStoryFlow
            keepsakes={keepsakes}
            onLaunchSeed={({ title, premise, tone, npcCast, mode, keepsakeId, readingMode }) =>
              // Reader-authored open seeds always launch from the open-canvas
              // starter shell. Pass title as both titleOverride (so the
              // library row shows the reader-authored title) and inside the
              // seed object (so the backend persists it as the LLM
              // `storyTitle` field). The optional cast is forwarded to the
              // backend as `seedNpcs` via useLibrary → gameApi. Wave 3 threads
              // the chosen mode (Story/Hardcore) + carried keepsakeId (BC3).
              // reading-modes cleanup: forward the chosen Branching/Novel
              // readingMode as createSave's 6th `options` arg (matching
              // home/library/discover), else the custom-seed Novel choice is a
              // silent no-op; the server re-gates Novel on entitlement.
              library.createSave(
                OPEN_STARTER_ID,
                mode,
                title,
                narrator.voiceId,
                {
                  premise,
                  title,
                  tone,
                  npcs: npcCast,
                  ...(keepsakeId ? { keepsakeId } : {}),
                },
                { readingMode },
              )
            }
            onSeedLaunched={(save) => router.push(`/read/${save.saveId}`)}
          />

          <Divider />

          <View style={{ gap: tokens.spacing.sm, maxWidth: 680 }}>
            <Text variant="subtitle">Author a custom seed</Text>
            <Text muted>Or build a full custom rule-seed from scratch below.</Text>
            {!guest.session ? (
              <Button onPress={() => router.push("/")} variant="ghost">
                Start reading first
              </Button>
            ) : null}
          </View>

          <Surface padded style={{ maxWidth: 680, width: "100%" }}>
            <View style={{ gap: tokens.spacing.md }}>
              <View
                style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
              >
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text variant="subtitle">Your drafts</Text>
                </View>
                {/* Req 22.4: creator analytics live one hop from the shelf. */}
                <Button onPress={() => router.push("/creator/dashboard")} variant="ghost">
                  Creator dashboard
                </Button>
              </View>
              {shelf.length === 0 ? (
                <Text muted>No saved drafts yet. Save one below and it will appear here.</Text>
              ) : (
                shelf.map((item) => (
                  <View
                    key={item.seedId}
                    style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
                  >
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text>{item.title}</Text>
                    </View>
                    <Chip variant={item.status === "published" ? "accent" : "muted"}>{item.status}</Chip>
                    {item.source === "local" ? <Chip variant="muted">this device</Chip> : null}
                    <Button disabled={busy} onPress={() => loadShelfSeed(item)}>
                      Load
                    </Button>
                    {item.source === "remote" ? (
                      <Button disabled={busy} onPress={() => archiveShelfSeed(item)} variant="ghost">
                        Archive
                      </Button>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </Surface>

          <View style={{ alignItems: "stretch", flexDirection: isPhone ? "column" : "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface padded style={{ flex: 1, minWidth: isPhone ? undefined : 320, width: "100%" }}>
            <View style={{ gap: tokens.spacing.md }}>
              <TextInput
                accessibilityLabel="Seed title"
                onChangeText={setTitle}
                placeholder="Adventure title"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: inputBorderColor("title"),
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={title}
              />
              <FieldIssues issues={fieldIssues.title} />
              <TextInput
                accessibilityLabel="Opening seed"
                multiline
                onChangeText={setOpening}
                placeholder="Opening seed"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: inputBorderColor("opening"),
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 140,
                  padding: tokens.spacing.md,
                  textAlignVertical: "top",
                }}
                value={opening}
              />
              <FieldIssues issues={fieldIssues.opening} />
              <TextInput
                accessibilityLabel="Careful choice"
                onChangeText={setCarefulChoice}
                placeholder="Careful choice"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: inputBorderColor("carefulChoice"),
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={carefulChoice}
              />
              <FieldIssues issues={fieldIssues.carefulChoice} />
              <TextInput
                accessibilityLabel="Bold choice"
                onChangeText={setBoldChoice}
                placeholder="Bold choice"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: inputBorderColor("boldChoice"),
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={boldChoice}
              />
              <FieldIssues issues={fieldIssues.boldChoice} />
              <FieldIssues issues={fieldIssues.general} />
              <Divider />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Validation required</Chip>
                <Chip>Safety gated</Chip>
                <Chip>Play-time attribution</Chip>
              </View>
              <Surface padded variant="muted">
                <View style={{ gap: tokens.spacing.sm }}>
                  <Text variant="subtitle">Preview</Text>
                  <Text>{story.nodes.start?.seed ?? opening}</Text>
                  <Text muted variant="bodySmall">{carefulChoice}</Text>
                  <Text muted variant="bodySmall">{boldChoice}</Text>
                </View>
              </Surface>
              {publishPanelOpen ? (
                <Surface padded variant="muted">
                  <View style={{ gap: tokens.spacing.md }}>
                    <Text variant="subtitle">Shelve this seed</Text>
                    <TextInput
                      accessibilityLabel="Seed synopsis"
                      multiline
                      onChangeText={(next) => setSynopsis(next.slice(0, 200))}
                      placeholder="One-line synopsis for the shelf card"
                      placeholderTextColor={tokens.colors.textFaint}
                      style={{
                        borderColor: tokens.colors.borderMuted,
                        borderRadius: tokens.radii.sm,
                        borderWidth: tokens.borderWidths.regular,
                        color: tokens.colors.text,
                        minHeight: 66,
                        padding: tokens.spacing.md,
                        textAlignVertical: "top",
                      }}
                      value={synopsis}
                    />
                    <Text muted variant="caption">{`${synopsis.length}/200`}</Text>
                    <Text muted variant="bodySmall">Tone</Text>
                    <SeedToneSelector onChange={setPublishTone} value={publishTone} />
                    <Text muted variant="bodySmall">Who can find it</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                      <Button
                        accessibilityLabel="Visibility Public shelf"
                        disabled={busy}
                        onPress={() => setVisibility("public")}
                        variant={visibility === "public" ? "primary" : "default"}
                      >
                        Public shelf
                      </Button>
                      <Button
                        accessibilityLabel="Visibility Unlisted"
                        disabled={busy}
                        onPress={() => setVisibility("unlisted")}
                        variant={visibility === "unlisted" ? "primary" : "default"}
                      >
                        Unlisted
                      </Button>
                    </View>
                    <Text muted variant="bodySmall">Remix policy</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                      <Button
                        accessibilityLabel="Remix allowed"
                        disabled={busy}
                        onPress={() => setRemixAllowed(true)}
                        variant={remixAllowed ? "primary" : "default"}
                      >
                        Remix allowed
                      </Button>
                      <Button
                        accessibilityLabel="Remix disabled"
                        disabled={busy}
                        onPress={() => setRemixAllowed(false)}
                        variant={remixAllowed ? "default" : "primary"}
                      >
                        No remixing
                      </Button>
                    </View>
                    {advisories.length > 0 ? (
                      <View accessibilityRole="alert" style={{ gap: tokens.spacing.xs }}>
                        <Text variant="bodySmall">
                          A few advisories — none of these block publishing, but readers may
                          notice them:
                        </Text>
                        {advisories.map((advisory) => (
                          <Text key={`${advisory.path}:${advisory.message}`} muted variant="caption">
                            {advisory.message}
                          </Text>
                        ))}
                        <Text muted variant="caption">
                          Confirm below to publish anyway.
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                      <Button disabled={busy} onPress={publishSeed} variant="primary">
                        Confirm and publish
                      </Button>
                      <Button
                        disabled={busy}
                        onPress={() => {
                          setPublishPanelOpen(false);
                          setStatus("Publish canceled. The draft is untouched.");
                        }}
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                    </View>
                  </View>
                </Surface>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button disabled={busy} onPress={saveDraft}>Save draft</Button>
                {!publishPanelOpen ? (
                  <Button disabled={busy} onPress={openPublishPanel} variant="primary">
                    Publish seed
                  </Button>
                ) : null}
                {/* Close the publish loop (panel-review-2 merged fix): after a
                    publish the creator can jump straight to the tale live on the
                    shelf and to the dashboard where reads/quit-points land —
                    no longer only "Open in library". The shelf link shows only
                    for a PUBLIC publish (unlisted seeds never reach Discover).
                    DEPENDENCY (PANEL-SERVER): the "your seed" echo — highlighting
                    the creator's own card — needs `ownerHandle` on the publish
                    response + `isMine` on listPublishedPublic; neither is wired
                    yet, so the deep-link lands the creator on Discover without a
                    self-highlight for now. */}
                {publishedSeedId ? (
                  <>
                    {visibility === "public" ? (
                      <Button
                        accessibilityLabel="See it on the community shelf"
                        onPress={() => router.push("/discover")}
                        variant="primary"
                      >
                        See it on the shelf
                      </Button>
                    ) : null}
                    <Button
                      accessibilityLabel="Watch readers arrive on the creator dashboard"
                      onPress={() => router.push("/creator/dashboard")}
                    >
                      Watch readers arrive
                    </Button>
                    <Button onPress={() => router.push("/library")} variant="ghost">
                      Open in library
                    </Button>
                  </>
                ) : null}
              </View>
              <Text accessibilityLabel="Creator status" muted>{status}</Text>
            </View>
          </Surface>
          <Surface padded style={{ flex: 1, minWidth: isPhone ? undefined : 280, width: "100%" }} variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">After publishing</Text>
              <Text muted>
                Published seeds appear in your Library — and, when shelved as public, on the
                community shelf in Discover where any reader can begin or remix them. Drafts
                saved on this device stay here until you publish them.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button onPress={() => router.push("/library")} variant="primary">Open library</Button>
                <Button onPress={() => router.push("/discover")} variant="ghost">Open Discover</Button>
              </View>
            </View>
          </Surface>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Inline per-field error list rendered directly under the input it maps to.
 * (`| undefined` is explicit for exactOptionalPropertyTypes — callers pass
 * `fieldIssues.<field>` which is `string[] | undefined`.) */
function FieldIssues({ issues }: { issues?: string[] | undefined }) {
  if (!issues || issues.length === 0) return null;
  return (
    <View accessibilityRole="alert" style={{ gap: 2 }}>
      {issues.map((message) => (
        <Text key={message} tone="danger" variant="bodySmall">
          {message}
        </Text>
      ))}
    </View>
  );
}

function buildCreatorStory(input: {
  title: string;
  opening: string;
  carefulChoice: string;
  boldChoice: string;
}): Story {
  const title = input.title.trim() || "Untitled Seed";
  return {
    id: slugify(title),
    version: 1,
    title,
    defaultSceneLength: "standard",
    startNodeId: "start",
    deathNodeId: "ending-risk",
    initialState: {
      vitality: 4,
      currency: 0,
      attributes: {
        resolve: {
          id: "resolve",
          label: "Resolve",
          value: 1,
          visibility: "visible",
        },
      },
      inventory: [],
      flags: {},
    },
    endings: {
      "ending-careful": { id: "ending-careful", label: "A Clear Route", kind: "success" },
      "ending-risk": { id: "ending-risk", label: "The Lantern Goes Out", kind: "death" },
    },
    nodes: {
      start: {
        id: "start",
        title,
        seed: input.opening.trim() || `${title} begins with a clear, general-audience opening.`,
        choices: [
          {
            id: "careful",
            label: input.carefulChoice.trim() || "Take the careful path.",
            targetNodeId: "ending-careful",
            effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
          },
          {
            id: "bold",
            label: input.boldChoice.trim() || "Take the bold path.",
            targetNodeId: "ending-risk",
            effects: [{ kind: "stat", statId: "vitality", delta: -4 }],
          },
        ],
      },
      "ending-careful": {
        id: "ending-careful",
        seed: "The path resolves into a safe success ending.",
        endingId: "ending-careful",
        choices: [],
      },
      "ending-risk": {
        id: "ending-risk",
        seed: "A story hazard ends the attempt without unsafe self-directed framing.",
        endingId: "ending-risk",
        isDeath: true,
        choices: [],
      },
    },
  };
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "untitled-seed";
}
