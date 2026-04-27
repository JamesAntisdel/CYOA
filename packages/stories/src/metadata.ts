import type { Story } from "@cyoa/engine";

export type StorySummary = {
  id: string;
  title: string;
  summary: string;
  tone: string;
  difficulty: "tutorial" | "easy" | "medium" | "hard";
  estimatedLength: string;
  entitlementRequired: "free" | "unlimited" | "pro";
  safetyProfile: "general" | "mature-allowed";
};

export type StarterStory = {
  summary: StorySummary;
  story: Story;
};
