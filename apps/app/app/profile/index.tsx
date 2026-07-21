import { ScrollView, View } from "react-native";

import { AppNav } from "../../components/navigation";
import { ProfileArchetypes } from "../../components/auth/ProfileArchetypes";
import { MementoShelf } from "../../components/account/MementoShelf";
import { Chip, Stamp, Surface, Text } from "../../components/primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useBreakpoint } from "../../lib/responsive";
import {
  librarianRankChipLabel,
  librarianRankProgressLine,
  rankTickerLine,
} from "../../lib/storyEngagementW3";
import { useAppTheme } from "../../theme";

export default function ProfileRoute() {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const {
    archetypes,
    keepsakes,
    librarianRank,
    mementos,
    profile,
    rankProgress,
    removeArchetype,
    renameArchetype,
    resetArchetypes,
    toggleArchetypeMute,
  } = useAccountProfile();

  return (
    <ScrollView
      contentContainerStyle={{
        alignItems: "center",
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
      }}
    >
      {/* Nav (incl. the candle-glyph home button) — /profile is the magic-link
          landing page, so without this a signed-in reader has no way back. */}
      <View style={{ maxWidth: 900, width: "100%" }}>
        <AppNav />
      </View>

      <Surface padded style={{ gap: tokens.spacing.sm, maxWidth: 640, width: "100%" }}>
        <Stamp>Profile</Stamp>
        <Text variant="title">{profile ? "Your reader" : "Guest reader"}</Text>
        <Text muted variant="bodySmall">
          {profile
            ? `Signed in as ${profile.kind} reader, age band ${profile.ageBand}.`
            : "Start a story and the narrator will begin shaping your reader profile."}
        </Text>
        {librarianRank ? (
          <View style={{ gap: tokens.spacing.xs }}>
            <View
              accessibilityLabel={`Librarian rank: ${librarianRankChipLabel(librarianRank)}. ${librarianRankProgressLine(librarianRank)}.`}
              style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
            >
              <Chip variant="accent">{`▣ ${librarianRankChipLabel(librarianRank)}`}</Chip>
              <Text muted variant="caption">
                {librarianRankProgressLine(librarianRank)}
              </Text>
            </View>
            {/* Rank-progress ticker (act-mementos R3.3): the next rung + the
                per-metric distance to it. Present only below the top tier —
                at "The Unwritten" rankProgress is absent and the totals line
                above stands alone, unchanged. */}
            {rankProgress ? (
              <Text style={{ color: tokens.colors.accent }} variant="caption">
                {rankTickerLine(rankProgress)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Surface>

      {keepsakes.length > 0 ? (
        <Surface padded style={{ gap: tokens.spacing.sm, maxWidth: 640, width: "100%" }}>
          <Stamp>keepsakes</Stamp>
          <Text muted variant="bodySmall">
            Echoes you've earned. Carry one into a new run to weave it in.
          </Text>
          <View style={{ gap: tokens.spacing.sm }}>
            {keepsakes.map((keepsake) => (
              <View
                key={keepsake.id}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.hairline,
                  gap: 2,
                  padding: tokens.spacing.md,
                }}
              >
                <Text style={{ fontWeight: "700" }} tone="accent" variant="bodySmall">
                  {`❖ ${keepsake.label}`}
                </Text>
                <Text muted variant="caption">
                  {keepsake.description}
                </Text>
              </View>
            ))}
          </View>
        </Surface>
      ) : null}

      {/* Mementos shelf (act-mementos R4) — mounted BELOW keepsakes, quieter
          cards, self-hiding when empty. The keepsakes shelf and trophy crypt
          above are untouched; the hierarchy is the dilution answer (R4.1). */}
      <MementoShelf mementos={mementos} />

      <ProfileArchetypes
        archetypes={archetypes}
        onRemove={removeArchetype}
        onRename={renameArchetype}
        onReset={resetArchetypes}
        onToggleMute={toggleArchetypeMute}
      />

      <View style={{ maxWidth: 640, width: "100%" }}>
        <Text muted variant="caption">
          Archetypes are inferred tags — never raw prose history. Muting a tag stops it from steering
          future scenes.
        </Text>
      </View>
    </ScrollView>
  );
}
