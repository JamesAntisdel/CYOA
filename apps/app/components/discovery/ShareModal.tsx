import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import { Button, Img, Stamp, Surface, Text } from "../primitives";

/**
 * Reasons a viewer might not be allowed to share. Mirrors Requirement 22-style
 * gates: must be signed-in, age-appropriate, and the tale must be public/unlisted.
 * Friends-only access requires authentication.
 */
export type ShareIneligibility =
  | "guest_account"
  | "private_tale"
  | "revoked"
  | "mature_blocked"
  | "no_link";

export type ShareEligibility =
  | { eligible: true; shareUrl: string }
  | { eligible: false; reason: ShareIneligibility };

/**
 * Canonical OG card asset path. Lives outside the app bundle today (in /export);
 * downstream agents will resolve this through a real Image require once the
 * marketing assets pipeline ships. The string is exported so tests can assert
 * the canonical reference is in place.
 */
export const OG_CARD_ASSET_PATH = "marketing/og-card";

type ShareModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Title of the tale being shared (display only — never embeds personal stats). */
  title: string;
  /** Optional synopsis displayed under the title. */
  synopsis?: string;
  /** Whether the viewer can share, plus the link if so. */
  eligibility: ShareEligibility;
  /** Called when the user taps "Copy link". Receives the URL. */
  onCopyLink?: (url: string) => void | Promise<void>;
};

function ineligibilityCopy(reason: ShareIneligibility): { title: string; body: string } {
  switch (reason) {
    case "guest_account":
      return {
        title: "Sharing waits for a name on the cover.",
        body: "Claim an account first; then the link will travel.",
      };
    case "private_tale":
      return {
        title: "This tale is kept on a private shelf.",
        body: "Only the publisher may pass it along.",
      };
    case "revoked":
      return {
        title: "The publisher closed this volume.",
        body: "The link no longer leads anywhere.",
      };
    case "mature_blocked":
      return {
        title: "Mature content cannot be shared with unverified readers.",
        body: "The recipient must be signed in and age-confirmed.",
      };
    case "no_link":
    default:
      return {
        title: "No link is available right now.",
        body: "Try again in a moment.",
      };
  }
}

/**
 * Share modal. Renders the canonical OG card preview plus a single share link.
 * Never embeds personal stats — the cover image is the marketing asset, not a
 * personalised summary.
 */
export function ShareModal({
  eligibility,
  onClose,
  onCopyLink,
  synopsis,
  title,
  visible,
}: ShareModalProps) {
  const { tokens } = useAppTheme();
  const { push } = useToast();

  const handleCopy = async () => {
    if (!eligibility.eligible) return;
    try {
      await onCopyLink?.(eligibility.shareUrl);
      push({ message: "Link tucked into the clipboard.", tone: "success" });
    } catch {
      push({ message: "The link refused to copy. Try once more.", tone: "warning" });
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View
        style={{
          backgroundColor: tokens.colors.overlay,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              padding: tokens.spacing.lg,
            }}
          >
            <Surface
              padded
              style={{
                alignSelf: "center",
                gap: tokens.spacing.lg,
                maxWidth: 480,
                width: "100%",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Stamp>share</Stamp>
                <Pressable
                  accessibilityLabel="Close share modal"
                  accessibilityRole="button"
                  onPress={onClose}
                >
                  <Text muted style={{ fontWeight: "700" }} variant="bodySmall">
                    close
                  </Text>
                </Pressable>
              </View>

              <View style={{ gap: tokens.spacing.sm }}>
                <Text variant="title">{title}</Text>
                {synopsis ? (
                  <Text muted variant="bodySmall">
                    {synopsis}
                  </Text>
                ) : null}
              </View>

              <Img
                accessibilityLabel="Marketing card preview"
                label={OG_CARD_ASSET_PATH}
                style={{ marginVertical: tokens.spacing.sm }}
              />

              {eligibility.eligible ? (
                <View style={{ gap: tokens.spacing.md }}>
                  <Surface
                    variant="muted"
                    style={{
                      paddingHorizontal: tokens.spacing.md,
                      paddingVertical: tokens.spacing.sm,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: tokens.typography.families.mono }}
                      variant="bodySmall"
                    >
                      {eligibility.shareUrl}
                    </Text>
                  </Surface>
                  <Button onPress={handleCopy} variant="primary">
                    Copy link
                  </Button>
                  <Text muted style={{ textAlign: "center" }} variant="caption">
                    The card carries the tale, not your stats.
                  </Text>
                </View>
              ) : (
                <IneligibilityNotice reason={eligibility.reason} />
              )}
            </Surface>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function IneligibilityNotice({ reason }: { reason: ShareIneligibility }) {
  const { tokens } = useAppTheme();
  const copy = ineligibilityCopy(reason);

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Text variant="subtitle">{copy.title}</Text>
      <Text muted variant="bodySmall">
        {copy.body}
      </Text>
    </View>
  );
}
