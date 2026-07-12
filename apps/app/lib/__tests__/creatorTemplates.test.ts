// "Begin from a template" prefill logic (creator-arc): the creator form starts
// from a CHOSEN starter stub or blank — never from hardcoded sample text (the
// old Lantern Market default-pollution problem).

import { describe, expect, it } from "vitest";

import {
  BLANK_CREATOR_FORM,
  listCreatorTemplates,
  templateFormValues,
} from "../creatorTemplates";

describe("creatorTemplates — listCreatorTemplates", () => {
  it("projects the llm-driven starter stubs as templates", () => {
    const templates = listCreatorTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "bone-cathedral",
      "iron-court",
      "ashfall",
    ]);
    for (const template of templates) {
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.opening.length).toBeGreaterThan(0);
      expect(template.tone.length).toBeGreaterThan(0);
    }
  });

  it("excludes authored starters (their value is the node graph, not a premise)", () => {
    expect(listCreatorTemplates().some((template) => template.id === "training-room")).toBe(false);
  });
});

describe("creatorTemplates — templateFormValues", () => {
  it("returns a fully blank form when no template is chosen", () => {
    expect(templateFormValues(null)).toEqual(BLANK_CREATOR_FORM);
    expect(templateFormValues(undefined)).toEqual(BLANK_CREATOR_FORM);
    expect(templateFormValues("")).toEqual(BLANK_CREATOR_FORM);
  });

  it("returns blank (never sample text) for unknown template ids", () => {
    expect(templateFormValues("lantern-market")).toEqual(BLANK_CREATOR_FORM);
  });

  it("prefills title + opening from the chosen stub, leaving choices as the creator's own", () => {
    const values = templateFormValues("bone-cathedral");
    expect(values.title).toBe("Bone Cathedral");
    expect(values.opening).toContain("cathedral built from yellowed bone");
    expect(values.carefulChoice).toBe("");
    expect(values.boldChoice).toBe("");
  });

  it("returns a fresh object each call so form state can't mutate the constant", () => {
    const first = templateFormValues(null);
    first.title = "mutated";
    expect(templateFormValues(null).title).toBe("");
    expect(BLANK_CREATOR_FORM.title).toBe("");
  });
});
