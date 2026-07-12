// Tier-aware provider routing (provider-and-credit design §1.2).
//
// Pins the ordering matrix — each entitlement tier maps to the expected
// sequence of provider steps (with the right Fireworks model tier per step) —
// and the mature-content eligibility gate.

import { describe, expect, it } from "vitest";

import {
  orderedProviders,
  providerOrder,
  type ProviderStep,
} from "../llm/providerPolicy";
import { createFireworksProvider } from "../llm/fireworks";
import { createAnthropicProvider } from "../llm/anthropic";
import { createVertexProvider } from "../llm/vertex";
import { createDeterministicProvider } from "../llm/deterministic";
import type { SceneGenerationRequest } from "../llm/types";

function request(overrides: Partial<SceneGenerationRequest> = {}): SceneGenerationRequest {
  return {
    saveId: "save",
    storyId: "story",
    nodeId: "node",
    seed: "A quiet room waits.",
    memory: [],
    choices: [{ choiceId: "go", label: "Go on" }],
    sceneLength: "standard",
    contentContext: {
      surface: "generation",
      entitlementTier: "free",
      matureContentEnabled: false,
    },
    risk: "normal",
    entitlementTier: "free",
    retryCount: 0,
    ...overrides,
  };
}

function asPairs(steps: ProviderStep[]): Array<[string, string | undefined]> {
  return steps.map((s) => [s.name, s.fireworksTier]);
}

describe("providerOrder — tier matrix (base, non-escalated)", () => {
  it("guest → Fireworks cheap → mid → deterministic; never Anthropic/Vertex", () => {
    const order = providerOrder(request({ tier: "guest" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "cheap"],
      ["fireworks", "mid"],
      ["deterministic", undefined],
    ]);
    expect(order.some((s) => s.name === "anthropic" || s.name === "vertex")).toBe(false);
  });

  it("free → Fireworks cheap → mid → deterministic; never Anthropic/Vertex", () => {
    const order = providerOrder(request({ tier: "free" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "cheap"],
      ["fireworks", "mid"],
      ["deterministic", undefined],
    ]);
    expect(order.some((s) => s.name === "anthropic" || s.name === "vertex")).toBe(false);
  });

  it("absent tier defaults to the free lane (cheapest, safest)", () => {
    expect(asPairs(providerOrder(request()))).toEqual(asPairs(providerOrder(request({ tier: "free" }))));
  });

  it("unlimited → Fireworks mid → premium → Vertex → deterministic; no Anthropic at base", () => {
    const order = providerOrder(request({ tier: "unlimited" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "mid"],
      ["fireworks", "premium"],
      ["vertex", undefined],
      ["deterministic", undefined],
    ]);
    expect(order.some((s) => s.name === "anthropic")).toBe(false);
  });

  it("pro → Fireworks premium → Anthropic → Vertex → deterministic", () => {
    const order = providerOrder(request({ tier: "pro" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "premium"],
      ["anthropic", undefined],
      ["vertex", undefined],
      ["deterministic", undefined],
    ]);
  });
});

describe("providerOrder — risk/retry is a secondary escalation hint only", () => {
  it("free escalation leads with the mid Fireworks model but still never Anthropic/Vertex", () => {
    const order = providerOrder(request({ tier: "free", risk: "sensitive" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "mid"],
      ["fireworks", "cheap"],
      ["deterministic", undefined],
    ]);
    expect(order.some((s) => s.name === "anthropic" || s.name === "vertex")).toBe(false);
  });

  it("a parse-retry (retryCount>0) escalates the free lane the same way", () => {
    const order = providerOrder(request({ tier: "free", retryCount: 1 }));
    expect(asPairs(order)[0]).toEqual(["fireworks", "mid"]);
  });

  it("unlimited escalation unlocks Anthropic as a last quality leg", () => {
    const order = providerOrder(request({ tier: "unlimited", risk: "sensitive" }));
    expect(asPairs(order)).toEqual([
      ["fireworks", "premium"],
      ["fireworks", "mid"],
      ["vertex", undefined],
      ["anthropic", undefined],
      ["deterministic", undefined],
    ]);
  });
});

describe("orderedProviders — resolves steps to instances and threads the Fireworks tier", () => {
  const providers = [
    createFireworksProvider(true),
    createAnthropicProvider(true),
    createVertexProvider(true),
    createDeterministicProvider(),
  ];

  it("free resolves to two Fireworks wrappers then deterministic", () => {
    const resolved = orderedProviders(providers, request({ tier: "free" }));
    expect(resolved.map((p) => p.name)).toEqual(["fireworks", "fireworks", "deterministic"]);
  });

  it("the two Fireworks wrappers inject distinct model tiers into the request", async () => {
    const seen: Array<string | undefined> = [];
    const spyFireworks = {
      ...createFireworksProvider(true),
      name: "fireworks" as const,
      generate: async (req: SceneGenerationRequest) => {
        seen.push(req.fireworksModelTier);
        return { provider: "fireworks" as const, text: "x", tokenUsage: { input: 1, output: 1 } };
      },
    };
    const resolved = orderedProviders([spyFireworks, createDeterministicProvider()], request({ tier: "free" }));
    await resolved[0]?.generate(request({ tier: "free" }));
    await resolved[1]?.generate(request({ tier: "free" }));
    expect(seen).toEqual(["cheap", "mid"]);
  });

  it("mature content drops the cheap Fireworks step (allowsMature=false) but keeps mid", () => {
    const matureReq = request({
      tier: "free",
      contentContext: {
        surface: "generation",
        ageBand: "18+",
        entitlementTier: "pro",
        matureContentEnabled: true,
      },
    });
    const resolved = orderedProviders(providers, matureReq);
    // Cheap step gated out; only the mid Fireworks wrapper + deterministic remain.
    expect(resolved.map((p) => p.name)).toEqual(["fireworks", "deterministic"]);
  });

  it("skips providers that are unavailable", () => {
    const resolved = orderedProviders(
      [createFireworksProvider(false), createDeterministicProvider()],
      request({ tier: "free" }),
    );
    expect(resolved.map((p) => p.name)).toEqual(["deterministic"]);
  });
});
