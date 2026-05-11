import { describe, expect, it } from "vitest";

import {
  PIP_DEFAULT_HOLD_MS,
  PIP_FADE_IN_MS,
  PIP_FADE_OUT_MS,
  formatStatPipAccessibilityLabel,
  resolveStatPipTimeline,
} from "../pipMotion";

describe("resolveStatPipTimeline", () => {
  it("uses the canvas-spec 3-second hold by default", () => {
    const timeline = resolveStatPipTimeline({ reducedMotion: false });
    expect(timeline.fadeInMs).toBe(PIP_FADE_IN_MS);
    expect(timeline.fadeOutMs).toBe(PIP_FADE_OUT_MS);
    expect(timeline.totalMs).toBe(
      PIP_FADE_IN_MS + Math.max(0, PIP_DEFAULT_HOLD_MS - PIP_FADE_OUT_MS) + PIP_FADE_OUT_MS,
    );
  });

  it("collapses the fade animation when reduced motion is on", () => {
    const timeline = resolveStatPipTimeline({ reducedMotion: true });
    expect(timeline.fadeInMs).toBe(0);
    expect(timeline.fadeOutMs).toBe(0);
    expect(timeline.holdMs).toBe(PIP_DEFAULT_HOLD_MS);
    expect(timeline.totalMs).toBe(PIP_DEFAULT_HOLD_MS);
  });

  it("respects an explicit holdMs override", () => {
    const timeline = resolveStatPipTimeline({ reducedMotion: false, holdMs: 1500 });
    expect(timeline.holdMs).toBe(Math.max(0, 1500 - PIP_FADE_OUT_MS));
  });

  it("never drives the hold window below zero", () => {
    const timeline = resolveStatPipTimeline({ reducedMotion: false, holdMs: 100 });
    expect(timeline.holdMs).toBe(0);
  });
});

describe("formatStatPipAccessibilityLabel", () => {
  it("emits a sentence with direction and magnitude", () => {
    expect(
      formatStatPipAccessibilityLabel({ label: "Vitality", delta: -5, value: 13 }),
    ).toBe("Vitality decreased by 5 (now 13)");
    expect(formatStatPipAccessibilityLabel({ label: "Nerve", delta: 1 })).toBe(
      "Nerve increased by 1",
    );
  });

  it("omits the value suffix when the new value is not provided", () => {
    const label = formatStatPipAccessibilityLabel({ label: "Insight", delta: 2 });
    expect(label.includes("(now")).toBe(false);
  });
});
