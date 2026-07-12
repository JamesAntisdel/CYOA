/**
 * "Begin from a template" cards (creator-arc; core-read-loop Req 22.1).
 *
 * Derives creator-form templates from the bundled starter stubs in
 * `packages/stories/src/stubs.ts` (bone-cathedral, iron-court, ashfall):
 * Discover renders them as template cards that route to
 * `/creator?template=<id>`, and the creator route prefills its custom-seed
 * form from `templateFormValues`. This replaces the old hardcoded
 * "Lantern Market" default text — the form now starts from a CHOSEN template
 * or blank, so sample prose can no longer pollute a saved draft by accident.
 *
 * Pure module (no React Native imports) — vitest-covered in
 * `lib/__tests__/creatorTemplates.test.ts`.
 */
import { listStarterStoryDefinitions } from "@cyoa/stories";

export type CreatorTemplate = {
  id: string;
  title: string;
  summary: string;
  tone: string;
  /** The stub's premise — becomes the form's opening text. */
  opening: string;
};

export type CreatorFormValues = {
  title: string;
  opening: string;
  carefulChoice: string;
  boldChoice: string;
};

/** A fully blank form — the default when no template is chosen. */
export const BLANK_CREATOR_FORM: CreatorFormValues = {
  title: "",
  opening: "",
  carefulChoice: "",
  boldChoice: "",
};

/**
 * The llm-driven starter stubs, projected as templates. Authored starters
 * (training-room) are excluded — their value is the hand-built node graph,
 * not a premise a creator would riff on.
 */
export function listCreatorTemplates(): CreatorTemplate[] {
  return listStarterStoryDefinitions()
    .filter((starter) => starter.summary.mode === "llm-driven")
    .map((starter) => ({
      id: starter.summary.id,
      title: starter.summary.title,
      summary: starter.summary.summary,
      tone: starter.summary.tone,
      opening: starter.story.nodes[starter.story.startNodeId]?.seed ?? "",
    }));
}

/**
 * Prefill values for the creator form. Unknown/absent template ids return the
 * blank form (never sample text). Templates seed title + opening only — the
 * two choice fields stay the creator's own words.
 */
export function templateFormValues(templateId: string | null | undefined): CreatorFormValues {
  if (!templateId) return { ...BLANK_CREATOR_FORM };
  const template = listCreatorTemplates().find((entry) => entry.id === templateId);
  if (!template) return { ...BLANK_CREATOR_FORM };
  return {
    title: template.title,
    opening: template.opening,
    carefulChoice: "",
    boldChoice: "",
  };
}
