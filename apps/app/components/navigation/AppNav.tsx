import { useRouter } from "expo-router";
import { Image, Pressable, View } from "react-native";

import { useAuthSession } from "../../hooks/useAuthSession";
import { brandAssets } from "../../lib/designAssets";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

type AppNavProps = {
  current?: "home" | "library" | "discover" | "creator" | "account" | "settings" | "login";
};

const navItems = [
  { key: "library", label: "Library", href: "/library" },
  { key: "discover", label: "Discover", href: "/discover" },
  { key: "creator", label: "Create", href: "/creator" },
  { key: "account", label: "Account", href: "/account" },
  { key: "settings", label: "Settings", href: "/settings" },
] as const;

export function AppNav({ current = "home" }: AppNavProps) {
  const router = useRouter();
  const auth = useAuthSession();
  const { tokens } = useAppTheme();
  const items = auth.session ? navItems : [...navItems, { key: "login", label: "Login", href: "/login" }] as const;

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.md,
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/")}
        style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}
      >
        <Image
          accessibilityLabel="The Unwritten candle mark"
          resizeMode="contain"
          source={brandAssets.glyphCandle}
          style={{ height: 32, width: 32 }}
        />
        <Text style={{ fontWeight: "800" }} variant="subtitle">The Unwritten</Text>
      </Pressable>

      <View
        accessibilityLabel="Main navigation"
        style={{
          alignItems: "center",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.xs,
          justifyContent: "flex-end",
        }}
      >
        {items.map((item) => {
          const active = current === item.key;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={item.key}
              onPress={() => router.push(item.href)}
              style={({ pressed }) => ({
                backgroundColor: active ? tokens.colors.text : "transparent",
                borderColor: active ? tokens.colors.text : tokens.colors.borderMuted,
                borderRadius: tokens.radii.pill,
                borderWidth: tokens.borderWidths.hairline,
                opacity: pressed ? 0.75 : 1,
                paddingHorizontal: tokens.spacing.md,
                paddingVertical: tokens.spacing.xs,
              })}
            >
              <Text
                style={{
                  color: active ? tokens.colors.background : tokens.colors.textMuted,
                  fontWeight: "800",
                }}
                variant="bodySmall"
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
