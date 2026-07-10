import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";

/**
 * Local fallback when no live provider is reachable. Produces deterministic
 * output so unit tests and local dev (`provider-mocks:4010`) stay stable.
 *
 * For llm-driven scenes the deterministic provider emits valid JSON in the
 * new contract so the engine validator + reader can be exercised end-to-end
 * without any real model call.
 */
export function createDeterministicProvider(): LlmProvider {
  return {
    name: "deterministic",
    role: "deterministic",
    health: () => ({ provider: "deterministic", available: true }),
    generate: async (request: SceneGenerationRequest, _signal?: AbortSignal): Promise<ProviderGeneration> => {
      const text = request.mode === "llm-driven" ? llmDrivenJson(request) : authoredText(request);
      // `isFallback: true` is the out-of-band sentinel that propagates through
      // RouterResult → SSE → completeSceneStream → scene.isFallback so the
      // reader UI can render a "this turn couldn't generate" panel instead of
      // the deterministic placeholder prose. The deterministic provider only
      // serves as a last-resort safety net (every real provider failed or was
      // ineligible), and the reader should NEVER see this output as if it
      // were a real scene.
      return {
        provider: "deterministic",
        text,
        tokenUsage: estimateTokenUsage(request.seed, text),
        isFallback: true,
      };
    },
  };
}

function authoredText(request: SceneGenerationRequest): string {
  const choices = request.choices.map((choice) => choice.label).join(", ");
  return `The candle gutters, but the page holds steady. ${request.seed} Choices remain: ${choices}.`;
}

function llmDrivenJson(request: SceneGenerationRequest): string {
  const premise = (request.premise ?? request.seed ?? "The page steadies.").slice(0, 320);
  // Derive a visualDescription so the image pipeline never falls back to
  // raw-prose truncation when the deterministic provider serves. Uses the
  // premise as the world anchor since that's the only concrete signal we
  // have in the deterministic path.
  const visualDescription =
    `Wide establishing shot anchored in the reader's premise: ${premise.slice(0, 240)}`.slice(0, 320);
  const payload = {
    prose: `${premise}\n\nThe candle holds; the page waits for the next word. Somewhere just beyond the margin, a sound that hasn't yet been a sound.`,
    choices: [
      {
        id: "press-on",
        label: "Press on into the story.",
        tone: "bold",
        effects: [{ kind: "flag_set", flag: "deterministic_pressed_on", value: true }],
      },
      {
        id: "hold-still",
        label: "Hold still and listen.",
        tone: "careful",
        effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
      },
    ],
    terminal: null,
    visualDescription,
  };
  return JSON.stringify(payload);
}

export function estimateTokenUsage(input: string, output: string): { input: number; output: number } {
  return {
    input: Math.ceil(input.length / 4),
    output: Math.ceil(output.length / 4),
  };
}
