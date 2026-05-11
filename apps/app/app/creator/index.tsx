import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Story } from "@cyoa/engine";

import { SeedStoryFlow } from "../../components/creator";
import { AppNav } from "../../components/navigation";
import { Button, Chip, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { createRemoteCreatorDraft, publishRemoteCreatorSeed } from "../../lib/gameApi";
import { saveLocalCreatorSeed } from "../../lib/localCreatorSeeds";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary } from "../../hooks/useLibrary";
import { useAppTheme } from "../../theme";

export default function CreatorRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const { tokens } = useAppTheme();
  const [title, setTitle] = useState("Lantern Market");
  const [opening, setOpening] = useState(
    "A midnight market opens under glass lanterns, and every stall asks for a different kind of courage.",
  );
  const [carefulChoice, setCarefulChoice] = useState("Ask the mapmaker which lantern is safest.");
  const [boldChoice, setBoldChoice] = useState("Follow the brightest lantern into the crowd.");
  const [seedId, setSeedId] = useState<string | null>(null);
  const [publishedSeedId, setPublishedSeedId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to save a draft.");
  const [busy, setBusy] = useState(false);
  const story = useMemo(
    () => buildCreatorStory({ title, opening, carefulChoice, boldChoice }),
    [boldChoice, carefulChoice, opening, title],
  );

  const saveDraft = async () => {
    if (!guest.session) {
      setStatus("Start a session before saving drafts.");
      return;
    }
    setBusy(true);
    try {
      const remote = await createRemoteCreatorDraft({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        title,
        story,
      });
      if (remote) {
        setSeedId(remote.seedId);
        saveLocalCreatorSeed({
          seedId: remote.seedId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Draft saved.");
      } else {
        const localId = `local_${story.id}`;
        setSeedId(localId);
        saveLocalCreatorSeed({
          seedId: localId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Draft saved on this device.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_draft_failed");
    } finally {
      setBusy(false);
    }
  };

  const publishSeed = async () => {
    if (!guest.session) {
      setStatus("Start a session before publishing.");
      return;
    }
    setBusy(true);
    try {
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
          });
          setSeedId(remote.seedId);
          saveLocalCreatorSeed({
            seedId: remote.seedId,
            title,
            story,
            status: published ? "published" : "draft",
            updatedAt: Date.now(),
          });
          if (published) setPublishedSeedId(remote.seedId);
          setStatus(published ? "Seed published." : "Draft saved. Publishing is not available yet.");
          return;
        }
        const localId = `local_${story.id}`;
        setSeedId(localId);
        saveLocalCreatorSeed({
          seedId: localId,
          title,
          story,
          status: "draft",
          updatedAt: Date.now(),
        });
        setStatus("Seed saved on this device. Publishing is not available yet.");
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
        return;
      }

      const published = await publishRemoteCreatorSeed({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        seedId: draftId,
      });
      saveLocalCreatorSeed({
        seedId: draftId,
        title,
        story,
        status: published ? "published" : "draft",
        updatedAt: Date.now(),
      });
      if (published) setPublishedSeedId(draftId);
      setStatus(published ? "Seed published." : "Publishing is not available yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "creator_publish_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 940, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <AppNav current="creator" />
          <View style={{ gap: tokens.spacing.sm, maxWidth: 680 }}>
            <Stamp>creator</Stamp>
            <Text variant="title">Seed an adventure</Text>
            <Text muted>Author an opening and a launchable rule seed.</Text>
          </View>

          <SeedStoryFlow
            starters={library.starterStories}
            onLaunchStarter={(starterId) => library.createSave(starterId)}
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
          <View style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface padded style={{ flex: 1, minWidth: 320 }}>
            <View style={{ gap: tokens.spacing.md }}>
              <TextInput
                accessibilityLabel="Seed title"
                onChangeText={setTitle}
                placeholder="Adventure title"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={title}
              />
              <TextInput
                accessibilityLabel="Opening seed"
                multiline
                onChangeText={setOpening}
                placeholder="Opening seed"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 140,
                  padding: tokens.spacing.md,
                  textAlignVertical: "top",
                }}
                value={opening}
              />
              <TextInput
                accessibilityLabel="Careful choice"
                onChangeText={setCarefulChoice}
                placeholder="Careful choice"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={carefulChoice}
              />
              <TextInput
                accessibilityLabel="Bold choice"
                onChangeText={setBoldChoice}
                placeholder="Bold choice"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
                value={boldChoice}
              />
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button disabled={busy} onPress={saveDraft}>Save draft</Button>
                <Button disabled={busy} onPress={publishSeed} variant="primary">Publish seed</Button>
                {publishedSeedId ? (
                  <Button onPress={() => router.push("/library")}>
                    Open in library
                  </Button>
                ) : null}
              </View>
              <Text accessibilityLabel="Creator status" muted>{status}</Text>
            </View>
          </Surface>
          <Surface padded style={{ flex: 1, minWidth: 280 }} variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">After publishing</Text>
              <Text muted>
                Published seeds appear in your Library. Drafts saved on this device stay here until you publish them.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button onPress={() => router.push("/library")} variant="primary">Open library</Button>
              </View>
            </View>
          </Surface>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
