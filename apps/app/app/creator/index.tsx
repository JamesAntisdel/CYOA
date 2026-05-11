import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SeedStoryFlow } from "../../components/creator";
import { Note } from "../../components/primitives";
import { useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";
import { useAppTheme } from "../../theme";

export default function CreatorRoute() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);

  const handleLaunchStarter = (starterId: string): LibrarySave | null => {
    if (!guest.session) return null;
    try {
      return library.createSave(starterId);
    } catch {
      return null;
    }
  };

  const handleSeedLaunched = (save: LibrarySave) => {
    router.push(`/read/${save.saveId}`);
  };

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          marginHorizontal: "auto",
          maxWidth: 760,
          padding: tokens.spacing.xl,
          paddingBottom: tokens.spacing.xxl,
          width: "100%",
        }}
      >
        {!guest.session ? (
          <View style={{ gap: tokens.spacing.md }}>
            <Note>Open the cover and pass the age gate before seeding an adventure.</Note>
          </View>
        ) : (
          <SeedStoryFlow
            onLaunchStarter={handleLaunchStarter}
            onSeedLaunched={handleSeedLaunched}
            starters={library.starterStories}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
