import { View } from "react-native";

import { useBreakpoint } from "../../lib/responsive";
import { Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

/**
 * Under-13 block panel. This block is permanent for the device — there is no
 * reset path through the UI by design.
 */
export function Under13Block() {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();

  return (
    // Mirror MatureOptIn's phone behavior — drop the 520 max so the block
    // claims the full content column at 375px viewport. The Surface is
    // alignSelf-centered by its host route (`alignItems: "center"` on the
    // ScrollView contentContainer), so removing the cap doesn't push it
    // off-axis. Keeps the danger frame symmetric on phone.
    <Surface
      padded
      style={{
        borderColor: tokens.colors.danger,
        gap: tokens.spacing.md,
        maxWidth: isPhone ? "100%" : 520,
        width: "100%",
      }}
    >
      <Stamp style={{ borderColor: tokens.colors.danger }}>
        Closed cover
      </Stamp>
      <Text variant="title">This book is for ages 13 and older.</Text>
      <View style={{ gap: tokens.spacing.sm }}>
        <Text>
          We can&apos;t open The Unwritten for readers under 13. This decision stays in place on this
          device.
        </Text>
        <Text muted variant="bodySmall">
          If a parent or guardian wants to discuss this, you can reach us through the help links in our
          store listing.
        </Text>
      </View>
    </Surface>
  );
}
