import { describe, expect, it } from "vitest";

import {
  isMachineId,
  preferredPathHint,
  prettifyEndingLabel,
  prettifyPathHint,
} from "../endingLabels";

describe("isMachineId", () => {
  it("matches synthetic llm node ids", () => {
    expect(isMachineId("open-canvas:llm:3")).toBe(true);
    expect(isMachineId("authored_seed:abc123:llm:12")).toBe(true);
  });

  it("rejects readable slugs and namespaced authored ids", () => {
    expect(isMachineId("grim-harvest")).toBe(false);
    expect(isMachineId("bone-cathedral:last-rite")).toBe(false);
    expect(isMachineId("open-canvas:llm:")).toBe(false);
  });
});

describe("prettifyEndingLabel", () => {
  it("prefers a server-persisted label when present", () => {
    expect(prettifyEndingLabel("grim-harvest", "The Grim Harvest ")).toBe("The Grim Harvest");
  });

  it("title-cases kebab and snake slugs when no label exists", () => {
    expect(prettifyEndingLabel("grim-harvest")).toBe("Grim Harvest");
    expect(prettifyEndingLabel("last_rite")).toBe("Last Rite");
  });

  it("keeps only the final readable segment of namespaced ids", () => {
    expect(prettifyEndingLabel("bone-cathedral:last-rite")).toBe("Last Rite");
  });

  it("falls back to a generic title for machine ids", () => {
    expect(prettifyEndingLabel("open-canvas:llm:7")).toBe("An unnamed ending");
    // An empty / whitespace label doesn't count as a real label.
    expect(prettifyEndingLabel("open-canvas:llm:7", "  ")).toBe("An unnamed ending");
  });
});

describe("prettifyPathHint", () => {
  it("drops machine segments and joins the readable ones", () => {
    expect(prettifyPathHint(["threshold", "open-canvas:llm:2", "iron-door"])).toBe(
      "Threshold → Iron Door",
    );
  });

  it("returns undefined when nothing human remains", () => {
    expect(prettifyPathHint(["open-canvas:llm:1", "open-canvas:llm:2"])).toBeUndefined();
    expect(prettifyPathHint([])).toBeUndefined();
    expect(prettifyPathHint(undefined)).toBeUndefined();
  });

  it("title-cases each readable segment", () => {
    expect(prettifyPathHint(["grim-harvest"])).toBe("Grim Harvest");
  });
});

describe("preferredPathHint", () => {
  it("prefers server-persisted choice labels over the node-id path", () => {
    expect(
      preferredPathHint(
        ["Strike the bargain", "Ring the last bell"],
        ["threshold", "iron-door"],
      ),
    ).toBe("Strike the bargain → Ring the last bell");
  });

  it("falls back to the prettified node-id path on legacy rows", () => {
    expect(preferredPathHint(undefined, ["threshold", "iron-door"])).toBe(
      "Threshold → Iron Door",
    );
    expect(preferredPathHint([], ["grim-harvest"])).toBe("Grim Harvest");
  });

  it("ignores blank labels and returns undefined when nothing human remains", () => {
    expect(preferredPathHint(["  ", ""], ["open-canvas:llm:1"])).toBeUndefined();
    expect(preferredPathHint(undefined, undefined)).toBeUndefined();
  });
});
