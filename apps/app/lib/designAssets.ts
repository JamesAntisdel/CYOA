import type { ImageSourcePropType } from "react-native";

export const brandAssets = {
  glyphCandle: require("../assets/design/marketing/favicon-512.png") as ImageSourcePropType,
  ogCard: require("../assets/design/marketing/og-card.png") as ImageSourcePropType,
} as const;

const storyCoverSources: Record<string, ImageSourcePropType> = {
  "training-room": require("../assets/design/covers/cover-training-room.png") as ImageSourcePropType,
  "bone-cathedral": require("../assets/design/covers/cover-bone-cathedral.png") as ImageSourcePropType,
  "iron-court": require("../assets/design/covers/cover-iron-court.png") as ImageSourcePropType,
  ashfall: require("../assets/design/covers/cover-ashfall.png") as ImageSourcePropType,
};

export function getStoryCoverSource(storyId: string): ImageSourcePropType {
  return storyCoverSources[storyId] ?? brandAssets.ogCard;
}
