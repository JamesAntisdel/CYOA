import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Divider, Stamp, Surface, Text } from "../../../components/primitives";
import {
  publishRemoteTale,
  type TaleForkPolicy,
  type TalePrivacy,
} from "../../../lib/talesApi";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import { useAppTheme } from "../../../theme";

const PRIVACY_OPTIONS: Array<{ value: TalePrivacy; label: string }> = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "friends", label: "Friends" },
];

const FORK_OPTIONS: Array<{ value: TaleForkPolicy; label: string }> = [
  { value: "any_decision", label: "Fork from any decision" },
  { value: "ending_only", label: "Fork from endings only" },
  { value: "disabled", label: "No forking" },
];

export default function PublishSaveRoute() {
  const { saveId } = useLocalSearchParams<{ saveId: string }>();
  const router = useRouter();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();

  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [privacy, setPrivacy] = useState<TalePrivacy>("public");
  const [forkPolicy, setForkPolicy] = useState<TaleForkPolicy>("any_decision");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Add a title and synopsis, then publish.");
  const [publishedTaleId, setPublishedTaleId] = useState<string | null>(null);

  const publish = async () => {
    if (!guest.session) {
      setStatus("Start a session before publishing.");
      return;
    }
    if (!saveId) {
      setStatus("Missing save to publish.");
      return;
    }
    if (title.trim().length === 0) {
      setStatus("A title is required.");
      return;
    }
    setBusy(true);
    setStatus("Running safety gates and snapshotting…");
    try {
      const result = await publishRemoteTale({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
        title: title.trim(),
        synopsis: synopsis.trim(),
        privacy,
        forkPolicy,
      });
      if (!result) {
        setStatus("Publish was blocked or unavailable. Check the content and try again.");
        return;
      }
      setPublishedTaleId(result.taleId);
      setStatus(
        result.isMature
          ? "Published. This tale is marked mature and hidden from general discovery."
          : `Published "${result.title}" with ${result.turnCount} turns.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "publish_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 720, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>publish</Stamp>
            <Text variant="title">Share this tale</Text>
            <Text muted>Snapshot source: {saveId}</Text>
          </View>
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Cover metadata</Text>
              <TextInput
                accessibilityLabel="Tale title"
                onChangeText={setTitle}
                placeholder="Title"
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
                accessibilityLabel="Tale synopsis"
                multiline
                onChangeText={setSynopsis}
                placeholder="One-line synopsis"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 88,
                  padding: tokens.spacing.md,
                  textAlignVertical: "top",
                }}
                value={synopsis}
              />
              <Divider />
              <Text muted variant="bodySmall">Who can see it</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                {PRIVACY_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    accessibilityLabel={`Privacy ${option.label}`}
                    disabled={busy}
                    onPress={() => setPrivacy(option.value)}
                    variant={privacy === option.value ? "primary" : "default"}
                  >
                    {option.label}
                  </Button>
                ))}
              </View>
              <Text muted variant="bodySmall">Fork policy</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                {FORK_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    accessibilityLabel={`Fork policy ${option.label}`}
                    disabled={busy}
                    onPress={() => setForkPolicy(option.value)}
                    variant={forkPolicy === option.value ? "primary" : "default"}
                  >
                    {option.label}
                  </Button>
                ))}
              </View>
              <Divider />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button disabled={busy} onPress={publish} variant="primary">
                  Run gates and publish
                </Button>
                {publishedTaleId ? (
                  <Button onPress={() => router.push(`/tale/${publishedTaleId}`)}>
                    Open tale
                  </Button>
                ) : null}
              </View>
              {privacy === "friends" ? (
                <Chip variant="muted">Friends-only requires sign-in to read</Chip>
              ) : null}
              <Text accessibilityLabel="Publish status" muted>{status}</Text>
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
