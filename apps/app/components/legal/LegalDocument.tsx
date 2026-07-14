import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { Divider, Stamp, Surface, Text } from "../primitives";

export type LegalSection = {
  heading: string;
  /** One or more paragraphs. Rendered in order. */
  body: string[];
};

export type LegalDocumentProps = {
  /** Short kicker above the title (e.g. "the covenant"). */
  kicker: string;
  title: string;
  /** Effective / last-updated line shown under the title. */
  effective: string;
  /** One-paragraph preamble in the reader's voice. */
  intro: string;
  sections: LegalSection[];
};

const CROSS_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/content-policy", label: "Content Policy" },
];

/**
 * Presentational host for the three static legal documents (Terms, Privacy,
 * Content Policy). Product-readiness launch blocker: the App Store / Play
 * console require in-product legal + a content policy before a UGC app with a
 * community shelf can ship. Copy is complete-but-placeholder (gothic house
 * voice) and MUST be reviewed by counsel before a public launch — see the
 * standing note each document carries.
 *
 * Pure presentation: takes structured copy and renders it. The three routes
 * under app/{terms,privacy,content-policy} supply the copy.
 */
export function LegalDocument({ kicker, title, effective, intro, sections }: LegalDocumentProps) {
  const { tokens } = useAppTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          marginHorizontal: "auto",
          maxWidth: 760,
          padding: tokens.spacing.xl,
          width: "100%",
        }}
      >
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>{kicker}</Stamp>
            <Text variant="title">{title}</Text>
            <Text muted variant="caption">
              {effective}
            </Text>
            <Text muted>{intro}</Text>
          </View>

          <Surface padded>
            <View style={{ gap: tokens.spacing.lg }}>
              {sections.map((section, index) => (
                <View key={section.heading} style={{ gap: tokens.spacing.sm }}>
                  {index > 0 ? <Divider /> : null}
                  <Text variant="subtitle">{section.heading}</Text>
                  {section.body.map((paragraph, pIndex) => (
                    <Text key={pIndex} muted variant="bodySmall">
                      {paragraph}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </Surface>

          <View style={{ gap: tokens.spacing.sm }}>
            <Text muted variant="caption">
              Placeholder counsel note: this document is a complete-structure draft for launch
              readiness and must be reviewed by a lawyer before it governs a public release.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.md }}>
              {CROSS_LINKS.filter((link) => link.label !== title).map((link) => (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${link.label}`}
                  key={link.href}
                  onPress={() => router.push(link.href as never)}
                >
                  <Text style={{ color: tokens.colors.accent, fontWeight: "700" }} variant="bodySmall">
                    {link.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
