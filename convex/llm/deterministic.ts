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
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      const text = request.mode === "llm-driven" ? llmDrivenJson(request) : authoredText(request);
      return {
        provider: "deterministic",
        text,
        tokenUsage: estimateTokenUsage(request.seed, text),
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
  // Two deterministic choices that exercise both stat and flag effects so the
  // engine's validation surface is fully covered in local dev runs.
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
  };
  return JSON.stringify(payload);
}

export function estimateTokenUsage(input: string, output: string): { input: number; output: number } {
  return {
    input: Math.ceil(input.length / 4),
    output: Math.ceil(output.length / 4),
  };
}
