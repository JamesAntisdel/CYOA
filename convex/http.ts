import type { SceneGenerationRequest, TokenChunk } from "./llm/types";
import { LlmRouter } from "./llm/router";

export async function collectSceneStream(
  request: SceneGenerationRequest,
  router = new LlmRouter(),
): Promise<TokenChunk[]> {
  const chunks: TokenChunk[] = [];
  for await (const chunk of router.streamScene(request)) {
    chunks.push(chunk);
  }
  return chunks;
}
