import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

export type LegalFooterLink = { href: string; label: string };

type LegalFooterProps = {
  /** Optional lead-in sentence, e.g. "By continuing you agree to our". */
  prefix?: string;
  links: LegalFooterLink[];
};

/**
 * Compact footer of tappable legal links (Terms / Privacy / Content Policy).
 * Product-readiness launch blocker: the age gate and publish flow must surface
 * the legal + content-policy documents before a UGC app can ship. Self-contained
 * (owns its own router) so any surface can drop it in.
 */
export function LegalFooter({ prefix, links }: LegalFooterProps) {
  const { tokens } = useAppTheme();
  const router = useRouter();

  return (
    <View
      accessibilityLabel="Legal links"
      style={{
        alignItems: "center",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.xs,
        justifyContent: "center",
      }}
    >
      {prefix ? (
        <Text muted variant="caption">
          {prefix}
        </Text>
      ) : null}
      {links.map((link, index) => (
        <View key={link.href} style={{ flexDirection: "row", gap: tokens.spacing.xs }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${link.label}`}
            onPress={() => router.push(link.href as never)}
          >
            <Text
              style={{ color: tokens.colors.accent, fontWeight: "700" }}
              variant="caption"
            >
              {link.label}
            </Text>
          </Pressable>
          {index < links.length - 1 ? (
            <Text muted variant="caption">
              ·
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
