import { ScrollView, View } from "react-native";

import { ProfileArchetypes } from "../../components/auth/ProfileArchetypes";
import { Stamp, Surface, Text } from "../../components/primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useAppTheme } from "../../theme";

export default function ProfileRoute() {
  const { tokens } = useAppTheme();
  const {
    archetypes,
    profile,
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
        padding: tokens.spacing.lg,
      }}
    >
      <Surface padded style={{ gap: tokens.spacing.sm, maxWidth: 640, width: "100%" }}>
        <Stamp>Profile</Stamp>
        <Text variant="title">{profile ? "Your reader" : "Guest reader"}</Text>
        <Text muted variant="bodySmall">
          {profile
            ? `Signed in as ${profile.kind} reader, age band ${profile.ageBand}.`
            : "Start a story and the narrator will begin shaping your reader profile."}
        </Text>
      </Surface>

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
