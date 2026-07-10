# Implementation Log: Task 10 Follow-up

**Summary:** Replaced placeholder-only LLM provider wrappers with real HTTP client implementations for Anthropic, Vertex/Gemini, and DeepSeek while preserving local provider-mock compatibility. Added Zod validation for scene generation requests, provider fallback on call/parse failure, and an SSE scene stream response helper.

**Timestamp:** 2026-04-29T23:55:00-07:00
**Log ID:** live-llm-clients-20260429

---

## Why This Follow-up Was Needed

The original Task 10 log accurately described a mockable router foundation, but the provider wrappers still returned deterministic prose inside each provider file. That made the task tracker look complete even though real provider calls could not run. This follow-up closes the implementation gap for provider client wiring while keeping local development non-billable by default.

The work does not mark live provider validation complete. Live validation is now tracked separately as `LR-3` in `tasks.md` because it requires Vault-backed keys and a real Convex deployment.

## Files Modified

- `convex/llm/anthropic.ts`
- `convex/llm/deepseek.ts`
- `convex/llm/vertex.ts`
- `convex/llm/router.ts`
- `convex/llm/providerPolicy.ts`
- `convex/llm/types.ts`
- `convex/http.ts`
- `convex/tests/llmRouter.test.ts`
- `.env.example`
- `docs/local-docker.md`
- `docs/vault.md`
- `README.md`
- `apps/app/app/settings/index.tsx`

## Files Created

- `convex/llm/httpClient.ts`

---

## Artifacts

### `convex/llm/httpClient.ts`

- **Purpose:** Shared HTTP utility for provider wrappers.
- **Key functions:**
  - `buildProviderPrompt(request)` builds the final provider prompt from the scene prompt and output-shape instruction.
  - `postJson({ url, headers, body, timeoutMs })` posts JSON with abort timeout and provider error normalization.
  - `generationFromText(...)` maps provider text and token usage into `ProviderGeneration`.
  - `readEnv(key)` reads trimmed Convex/process env values.
  - `readTimeoutMs()` resolves `LLM_TIMEOUT_MS`, defaulting to 15000ms.
  - `isLocalProviderUrl(url)` identifies local/mock endpoints.
  - `appendPath(baseUrl, path)` safely appends provider paths for Anthropic and DeepSeek.

### `createAnthropicProvider`

- **Location:** `convex/llm/anthropic.ts`
- **Behavior now:** Calls Anthropic Messages-compatible HTTP API at `ANTHROPIC_BASE_URL` or `https://api.anthropic.com/v1/messages`.
- **Config env:** `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `LLM_TIMEOUT_MS`.
- **Local mode:** Available when `ANTHROPIC_BASE_URL` points to a local/provider-mock URL.
- **Live mode:** Available when `ANTHROPIC_API_KEY` is present.
- **Response parsing:** Reads `content[].text` and `usage.input_tokens/output_tokens`.

### `createDeepSeekProvider`

- **Location:** `convex/llm/deepseek.ts`
- **Behavior now:** Calls OpenAI-compatible chat completions at `DEEPSEEK_BASE_URL` or `https://api.deepseek.com/chat/completions`.
- **Config env:** `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `LLM_TIMEOUT_MS`.
- **Local mode:** Available when `DEEPSEEK_BASE_URL` points to provider mocks.
- **Live mode:** Available when `DEEPSEEK_API_KEY` is present.
- **Response parsing:** Reads `choices[0].message.content` and usage token counts.

### `createVertexProvider`

- **Location:** `convex/llm/vertex.ts`
- **Behavior now:** Calls Vertex/Gemini-compatible `generateContent`.
- **Config env:** `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_ACCESS_TOKEN`, `VERTEX_BASE_URL`, `VERTEX_TEXT_MODEL`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `LLM_TIMEOUT_MS`.
- **Routing detail:** Uses Vertex AI endpoint only when both `VERTEX_PROJECT_ID` and `VERTEX_ACCESS_TOKEN` are present; otherwise uses the Gemini API endpoint with `GEMINI_API_KEY`.
- **Local mode:** Available when `VERTEX_BASE_URL` points to provider mocks.
- **Response parsing:** Reads `candidates[0].content.parts[].text` and `usageMetadata`.

### Router Fallback

- **Location:** `convex/llm/router.ts`
- **Change:** Router now iterates eligible ordered providers and falls through on provider call failures or parse failures. Deterministic fallback is used when all eligible live providers fail.
- **Security/safety:** Provider output is parsed before content-policy evaluation. Block/safe-end policy still forces deterministic fallback.

### Zod Scene Request Validation

- **Location:** `convex/llm/types.ts`
- **Export:** `sceneGenerationRequestSchema`
- **Purpose:** Validates direct HTTP scene-stream request shape before any LLM provider can be invoked.

### SSE Stream Response

- **Location:** `convex/http.ts`
- **Export:** `sceneStreamResponse(request, router?)`
- **Route:** `/llm/scene-stream`
- **Events:** `token`, `done`, `error`
- **Current guard:** Requires `LLM_STREAM_SECRET` via `x-cyoa-stream-secret`.
- **Launch caveat:** Shared-secret stream auth is temporary. `LR-2` tracks replacement with account/save authorization.

---

## Tests Added or Expanded

- Anthropic-compatible HTTP call maps response and token usage.
- Router falls back to deterministic output when a live provider throws.
- `sceneGenerationRequestSchema` accepts valid requests and rejects bad retry counts or malformed choices.
- SSE helper emits `token` and `done` events.
- SSE helper redacts raw provider exception details.
- Provider HTTP utility rejects non-local plain HTTP provider URLs before sending credentials.

## Verification

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:e2e` passed.
- `pnpm audit --audit-level moderate` passed after follow-up security overrides.

## Residual Risks / Follow-up

- `LR-2`: Replace `LLM_STREAM_SECRET` with session-aware account/save authorization.
- `LR-3`: Run live provider smoke tests with Vault-synced credentials in a Convex deployment.
- Provider SDKs are not used. This is intentional for now: provider-specific code remains isolated in `convex/llm/*`, and direct HTTPS clients avoid additional dependency weight. Revisit SDK use only if streaming/protocol support requires it.
