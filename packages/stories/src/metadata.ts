import type { Story } from "@cyoa/engine";

export type StoryMode = "authored" | "llm-driven";

export type StorySummary = {
  id: string;
  title: string;
  summary: string;
  tone: string;
  difficulty: "tutorial" | "easy" | "medium" | "hard";
  estimatedLength: string;
  entitlementRequired: "free" | "unlimited" | "pro";
  safetyProfile: "general" | "mature-allowed";
  /**
   * "authored" stories ship a complete node graph that the engine walks
   * deterministically; the LLM only writes prose at each authored node.
   * "llm-driven" stories ship a single `start` node (premise/seed/initial
   * state) and rely on the LLM to propose prose + choices + effects each
   * turn — validated and applied by the engine. The training-room tutorial
   * stays "authored"; the seed stubs are "llm-driven".
   */
  mode: StoryMode;
};

export type StarterStory = {
  summary: StorySummary;
  story: Story;
};
