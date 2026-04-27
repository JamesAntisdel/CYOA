# Technology Stack

## Project Type

CYOA is a **client + reactive-backend interactive fiction game** delivered as:

1. A responsive **web app** at a single URL (the day-one product).
2. **iOS and Android** apps shipped from the same codebase via Expo (post-MVP, but architected from day one).
3. A **Convex backend** that owns persistent player state, drives the LLM call loop, evaluates the deterministic engine rules from the **Game Designer's Specification: CYOA Web Engine** (the "Game Spec"), bills subscriptions, and pushes reactive updates to subscribed clients.

The split is deliberate: the LLMs are non-deterministic and slow, but the rules engine (Game Spec §2 — branching, attributes, scene effects) must be deterministic, fast, and auditable. The backend owns all engine evaluation; the LLMs are *content providers* that fill prose, images, and short cinematic videos around engine-decided structure.

## Core Technologies

### Primary Language(s)

- **TypeScript** end-to-end (client, Convex functions, shared engine library, Pulumi infra). One type system across web, native, backend, and IaC means engine types are defined once and consumed everywhere — including in Pulumi for typed env wiring.
- **Node.js (LTS, ≥20)** for local tooling and Pulumi.
- **Package manager**: `pnpm` with workspaces.

### Key Dependencies/Libraries

- **Expo (SDK 51+)** + **Expo Router** — single React/RN codebase compiles to web (via React Native Web), iOS, and Android. Day-one platform per user directive ("built so we can use expo and do an ios/android experience").
- **React 18** — UI runtime; React Native components are the primitive for both web and native.
- **Convex** — the backend platform. Owns:
  - **Tables** (Convex schema) — `accounts`, `saves`, `turn_history`, `endings_unlocked`, `story_tags_index`, `analytics_events`, `daily_turn_counter`, `assets` (generated images/videos with provenance).
  - **Queries** (reactive reads) — drive the reading view, endings map, trophy crypt; clients subscribe and receive pushes when state mutates.
  - **Mutations** (transactional writes) — apply engine state transitions atomically.
  - **Actions** (side-effectful, may call external APIs) — LLM orchestration (Anthropic / Vertex AI / DeepSeek), Stripe, BetterAuth callbacks.
  - **HTTP actions** — used for streaming SSE token-by-token from the LLM to the client.
  - **Scheduled functions** — daily-turn-counter resets, guest-save TTL sweeps, asset-generation backfill jobs.
  - **Vector indexes** — embeddings of past scenes for memory-window retrieval ("the 5 most relevant prior beats when generating the next scene").
  - **File storage** — generated illustrations and short videos (with R2/GCS mirror for CDN delivery).
- **BetterAuth** — primary auth layer. Convex integration via `@convex-dev/better-auth` (or a thin custom adapter if the integration lags behind). **SSO providers enabled at launch**: Google, Apple, GitHub, Microsoft, Discord. Email + magic link as the universal fallback. Crucially supports **guest sessions that can be claimed into an account** without losing save state — required by the wireframes' soft-signup-mid-play prompt.
- **Anthropic SDK (`@anthropic-ai/sdk`)** — primary narrative model. Default `claude-sonnet-4-6` for prose; `claude-haiku-4-5` for fast classification (e.g. "did this choice trip a hidden flag?", "summarize this scene for the memory window"). Streamed via Convex HTTP actions so prose appears progressively (the "candle reveal" feel).
- **Google Gen AI SDK (`@google/generative-ai`)** + **Vertex AI** — secondary narrative model (Gemini Pro / Flash) for A/B comparison, fallback when Anthropic is degraded, and use cases where Vertex AI is preferred (e.g. enterprise IAM, regional residency). All Google-side calls (Gemini, Imagen, Veo) go through **Vertex AI** for unified billing, IAM, quotas, and audit.
- **DeepSeek API** — cost-optimized text provider slot for eligible low-risk prose, summaries, retries, and non-mature continuations. DeepSeek is routed through the same parser, safety, privacy, latency, and mature-content gates as every other text provider.
- **Vertex AI image generation (Gemini / Imagen)** — Pro-tier scene illustrations.
- **Vertex AI Veo** — Pro-tier short-form scene videos (5–8s loops at chapter beats and cinematic death screens).
- **Stripe Billing** + **Apple StoreKit** + **Google Play Billing** — subscription billing behind a single entitlement abstraction. **Stripe is the primary billing system** for web checkout, subscriptions, invoices, customer portal, usage meters, credit packs, upgrades, downgrades, cancellations, and tax-supported invoice records.
  - **Stripe** — canonical web billing, webhooks, plan changes, usage/credit accounting, customer portal, and Stripe Connect for creator revenue share (post-MVP). Webhooks land at a Convex HTTP action and update the player's `entitlements` row only after signature verification and idempotency checks.
  - **Apple StoreKit 2** (`expo-iap` or `react-native-iap`) — surfaces in-app purchase UI on iOS where app-store policy requires native IAP; receipts are verified server-side and normalized into Convex entitlements.
  - **Google Play Billing** — same role on Android.
- **Zod** — runtime validation at all trust boundaries (LLM output → engine, client → Convex, env → process, Stripe webhook → action).
- **Pulumi** (TypeScript) — infrastructure as code targeting **Google Cloud Platform** for static web hosting, GCP project + IAM for Vertex AI, Secret Manager, DNS, monitoring. Convex itself is fully managed and provisioned via the Convex CLI, but its environment variables and deploy keys are managed in Pulumi/Secret Manager.

### Application Architecture

**Three layers, one repo:**

1. **Engine** (`packages/engine/`) — pure TypeScript library implementing the Game Spec data model: `Story`, `Node`, `Choice`, `EffectList`, `Attribute`, `Inventory`, `Flag`, `Mode` (`"story" | "hardcore"`). Pure functions: `applyChoice(state, choice) → state'`, `evaluateConditions(state, choice) → "visible" | "locked" | "hidden"`, `enterNode(state, node) → state'` (which fires Auto-Modifiers per §2.C). **No I/O, no React, no LLM, no Convex imports.** The engine is the rules; everything else is fungible.
2. **Convex backend** (`convex/`) — orchestrates the loop: load save → engine evaluates current state → LLM router selects a quality-first, fallback, or cost-optimized provider (Anthropic / Gemini / DeepSeek) → engine validates & canonicalizes → mutation persists save → reactive query pushes update to client. Owns LLM keys (in Convex env), Stripe webhooks, daily-turn-counter, BetterAuth callbacks, asset-generation schedules.
3. **Client** (`apps/app/`, an Expo Router app) — renders the scene, captures the choice, calls a Convex mutation/action, applies streamed/reactive responses. Owns *no* engine logic; the client mirrors backend state, never extends it. (This is what makes "Hardcore = save purged on death" tamper-resistant: the client cannot decide it didn't die.)

**Read-loop sequence (one turn):**

```
client → convex.action("turn.submit", { saveId, choiceId })
  ↓
action: load save  →  engine.applyChoice  →  if vitality≤0, jump to designated Death scene
  ↓
build memory window: vector-search past scenes for relevance
  ↓
call LLM through provider router (Anthropic quality-first → Gemini fallback → DeepSeek cost-optimized where eligible) via streaming HTTP action
  ↓
stream tokens to client over SSE; reactive query pushes interim state
  ↓
on completion: parse next-node candidates with Zod, engine validates, mutation persists save
  ↓
(Pro tier, async) schedule Vertex AI Imagen/Veo job → on completion, mutation attaches asset URL
  ↓
client reactive query updates → illustration/video fades in over the prose
```

The engine is invoked **before** and **after** every LLM call: before, to decide what state the LLM is writing into; after, to bind the LLM's narrative output to a deterministic next-node and stat patch. **The LLM never directly mutates player state.** This is the structural defense against prompt injection.

### Data Storage

- **Primary store**: **Convex** (reactive document/relational hybrid). One row per save with engine state stored as a structured document; turn history is an append-only table; analytics events live in their own table.
- **Caching**: Convex queries are reactive and cached on the client by Convex's runtime; explicit caching (e.g. for shared LLM-prompt outputs across the tutorial's first scene) lives in dedicated Convex tables with TTL via scheduled functions.
- **Vector store**: Convex's built-in vector indexes — used for memory-window retrieval (semantic search over past scene summaries) and (later) for cross-account ending similarity recommendations.
- **Object storage**: **GCP Cloud Storage** (provisioned via Pulumi) backing a Cloud CDN, fronting generated illustrations (Gemini/Imagen) and short videos (Veo). Convex File Storage holds the upload-side; a scheduled function mirrors hot assets to GCS for CDN delivery.
- **Data formats**: JSON for engine state and LLM I/O; PNG/WebP for illustrations; MP4/WebM for Veo video; opus/mp3 for audio.

### External Integrations

- **APIs**:
  - **Anthropic Messages API** — primary narrative (Claude Sonnet 4.6 streaming, Claude Haiku 4.5 for classification).
  - **Google Vertex AI** — secondary narrative (Gemini Pro/Flash), images (Gemini image / Imagen), video (Veo).
  - **DeepSeek** — cost-optimized text provider for eligible low-risk continuations and summaries.
  - **Stripe** — primary checkout, subscriptions, invoices, customer portal, metered usage, credit packs, plan changes, and Stripe Connect for creator payouts (post-MVP).
  - **Apple StoreKit 2** — iOS in-app purchases where app-store policy requires native IAP.
  - **Google Play Billing** — Android in-app purchases where app-store policy requires native IAP.
  - **BetterAuth + OAuth providers** — Google, Apple, GitHub, Microsoft, Discord.
- **Protocols**: HTTPS for the bulk; **Convex's reactive WebSocket** for query subscriptions (handled by the Convex client SDK on web and native); **SSE via Convex HTTP actions** for streaming LLM tokens token-by-token.
- **Authentication**: BetterAuth-issued sessions; Convex receives the session token via its auth integration and exposes the authenticated identity in `ctx.auth`. Native uses secure-store for token persistence; web uses HTTP-only cookies.

### Monitoring & Dashboard Technologies

- **Player-facing dashboards** (Endings Map, Trophy Crypt) are part of the main client — same React tree, same reactive Convex queries.
- **Operator-facing dashboard** (in-house, no third-party trackers per directive): a separate route group within `apps/app/` gated to admin accounts. Reads from Convex `analytics_events` aggregates.
  - **Funnel views**: activation → tutorial completion → signup → free→paid → paid→Pro.
  - **Cost dashboards**: per-provider LLM/image/video spend per session, per cohort, per story.
  - **Live counters**: DAU, concurrent reads, ending unlock rate, co-op session rate.
- **Real-time updates**: Convex reactive queries push deltas as analytics events land — no polling.
- **Visualization**: native React layout for tabular and bar-style charts; **D3** for the player-facing branching endings web (the only place that needs real graph layout).

## Development Environment

### Build & Development Tools

- **Build system**: Expo's bundler (Metro for native, Vite via Expo Web for web) for the client; Convex CLI for the backend.
- **Package management**: `pnpm` workspaces.
- **Development workflow**:
  - `pnpm dev:convex` — Convex dev server (live function reloading, local DB).
  - `pnpm dev:app` — Expo dev (web + native simulator).
  - `pnpm dev` — runs both in parallel via `concurrently`.
  - Engine package recompiles in watch mode and triggers downstream rebuilds via pnpm workspace deps.

### Code Quality Tools

- **Static analysis**: TypeScript in `strict` mode; ESLint with `@typescript-eslint`.
- **Formatting**: Prettier (defaults; `eslint-config-prettier` to resolve conflicts).
- **Testing**:
  - **Vitest** — high-coverage unit tests on `packages/engine/`. Engine is the rules-of-the-game; if the engine is wrong, no LLM saves us.
  - **convex-test** — Convex function tests against an in-memory backend with Anthropic / Vertex AI / DeepSeek and Stripe/native purchase receipts mocked.
  - **React Native Testing Library** — client component logic.
  - **Playwright** — end-to-end smoke tests on the web client (happy-path tutorial, paywall hit, signup-from-guest, death/restart).
- **Documentation**: TSDoc on the engine's public surface; auto-generated via TypeDoc.

### Version Control & Collaboration

- **VCS**: Git on GitHub.
- **Branching strategy**: trunk-based on `main`. Short-lived feature branches, squash-merge.
- **Code review**: required PR review for changes to `packages/engine/`, Convex schema migrations, and `infra/`. Lighter for client polish.

### Dashboard Development

- **Live reload**: Expo + Convex both hot-reload. Convex pushes function changes within seconds; client subscriptions reattach automatically.
- **Multi-instance**: each developer gets their own Convex dev deployment; `dev` / `staging` / `prod` Convex deployments isolated per env.

## Deployment & Distribution

- **Web client**: built via `expo export --platform web`, deployed to **GCP Cloud Storage + Cloud CDN** behind a custom domain (provisioned by Pulumi). Static — no server runtime.
- **Convex backend**: deployed via `npx convex deploy` against the prod Convex deployment. Convex is fully managed; we don't operate the runtime ourselves. Env vars (Anthropic key, Vertex AI service-account JSON, Stripe keys, BetterAuth secret) are pushed to Convex via CLI from values stored in **GCP Secret Manager**.
- **Infrastructure**: **Pulumi** (TypeScript) under `infra/` provisions:
  - GCP Project + APIs (Vertex AI, Cloud Storage, Cloud CDN, Cloud DNS, Secret Manager, IAM).
  - Service accounts: one for Convex → Vertex AI, one for the CI deploy pipeline.
  - Cloud Storage buckets: `cyoa-web` (static site), `cyoa-assets` (generated illustrations/videos with public-read via signed URLs).
  - Cloud CDN in front of both.
  - Cloud DNS records.
  - Secret Manager entries for all production secrets, mirrored into Convex env via the deploy pipeline.
- **Native apps**: built and submitted via **EAS Build / EAS Submit** (Expo's cloud build). OTA updates via **EAS Update** for JS bundle changes (lets us ship engine and UI fixes without an app-store review).
- **Distribution method**: Web — direct URL. Native — App Store / Google Play.
- **Installation requirements**: modern evergreen browser (last 2 versions of Chrome / Safari / Firefox / Edge); iOS 16+; Android 10+.
- **Update mechanism**: web — automatic on reload; native — EAS Update for JS, app-store update for native binaries.
- **CI/CD**: GitHub Actions runs lint + tests; on merge to `main`, Pulumi up → Convex deploy → Expo web build & sync to GCS → EAS update for native channels.

## Technical Requirements & Constraints

### Performance Requirements

- **First scene visible** within 1.5s of landing on the URL on a cold session.
- **Time-to-first-token** from the LLM ≤ 1.5s after a choice is submitted (the "book responding" perception). All work in the request path before the LLM call is latency we own.
- **Stat-delta animation** must fire ≤100ms after the relevant prose token arrives, per Game Spec §6.
- **Story ↔ inventory transition** ≤16ms (one frame) — inventory is a UI overlay, not a route change. Game Spec §6 (Flow).
- **Image generation (Imagen / Gemini)** may be multi-second; produced *async* and faded in once ready — never blocks the read.
- **Video generation (Veo)** may be tens of seconds; reserved for chapter beats and death cinematics; pre-fetched eagerly when the engine predicts a beat is approaching.

### Compatibility Requirements

- **Platform support**: Web (modern evergreen browsers), iOS 16+, Android 10+.
- **Dependency versions**: Node ≥20 LTS; pnpm ≥9; Expo SDK 51+; Convex latest stable.
- **Standards compliance**: WCAG 2.1 AA on web. All interactive elements keyboard-navigable. Generated video respects `prefers-reduced-motion`.

### Security & Compliance

- **Auth**: BetterAuth-issued sessions; rotated on suspicious activity. SSO via OIDC for Google / Apple / Microsoft / GitHub / Discord. Native: secure-store-backed token. Web: HTTP-only secure cookie.
- **Engine integrity**: client cannot mutate save state directly; every state transition is a Convex mutation/action authenticated by `ctx.auth`. Hardcore mode is meaningful only because of this.
- **LLM output sanitization**: all model output (Anthropic and Gemini) is treated as untrusted text. No HTML rendering, no eval. Output is parsed into a strict choice-shape Zod schema; anything that doesn't conform is retried or falls back to the engine's default-choice generator.
- **PII**: email and (for SSO) the provider-supplied profile fields are the only PII collected. Stripe handles payment info; we never see card numbers. Provider keys and Vertex AI service-account credentials never leave Convex env / GCP Secret Manager.
- **Compliance**: GDPR / CCPA — account export and account-deletion endpoints from day one (Convex actions; deletion cascades through saves, turn history, endings, and analytics).
- **Threat model — prompt injection**: structurally blocked. The LLM's output is reduced to *which canonical engine-provided choice was taken* and *narrative prose to display*; it never names the stat patch. Stat patches are produced by the engine. A user attempting "and now I have 999 gold" never reaches the engine because the LLM has no authority to mutate state.
- **Threat model — provider outages**: Anthropic, Vertex AI, and DeepSeek are independent provider slots; a provider outage triggers automatic fallback according to health, capability, safety risk, and cost policy, surfaced in-character when useful.

### Scalability & Reliability

- **Expected load**: opening 12 months — thousands of DAU; tens of thousands of LLM calls/day; bursty per turn but each call is short. Convex scales transparently.
- **Availability**: 99.5% target. Most likely failure mode is single-provider LLM outage — handled by Anthropic/Gemini/DeepSeek routing plus deterministic fallback for low-risk transitions.
- **Growth projections**: Convex + Vertex AI both scale horizontally without us doing infra work; Pulumi-managed GCP resources are the constant.

## Technical Decisions & Rationale

### Decision Log

1. **Convex over a self-hosted Hono+Postgres+Redis stack.** Convex collapses backend, real-time pushes, scheduled jobs, vector search, and file storage into one TypeScript-native service. The reading view is fundamentally reactive (one save updates → all subscribed clients see it) — Convex is built for that. Trade-off: vendor lock-in to Convex's runtime model. Accepted because the engine package is portable and contains all the rules; Convex hosts the *plumbing*, not the *game*.
2. **Pulumi (TypeScript) targeting GCP for the surrounding infra.** Pulumi gives us typed IaC in the same language as the rest of the codebase. GCP is the natural target because Vertex AI (Gemini, Imagen, Veo) lives there — co-locating compute, identity, and secrets in one cloud reduces cross-cloud auth friction.
3. **Expo + React Native Web for the unified client.** Single codebase for web + iOS + Android per user directive. Trade-off: React Native Web rough edges around web-only patterns (complex CSS, SEO). Accepted: most of this product is logged-in reading; the few SEO-critical surfaces (cover, library) can be statically rendered.
4. **Server-authoritative engine.** Hardcore permadeath requires unfakeable state. Every turn is a server round-trip; the round-trip is dwarfed by the LLM call.
5. **LLM as content provider, not state owner.** The engine decides which choices are valid and what state changes; the LLM only writes prose around them. This blocks prompt injection and makes LLM providers swappable.
6. **Provider router with Anthropic quality-first, Gemini fallback, and DeepSeek cost-optimized slots.** Anthropic Claude is the quality-first long-form narrative provider; Gemini via Vertex AI gives us a structurally independent fallback (different vendor, different region, different IAM); DeepSeek gives us a lower-cost path for eligible low-risk text. All providers are wired through one interface with identical parsing, safety, mature-content, privacy, and latency gates.
7. **Vertex AI for all Google-side calls (Gemini, Imagen, Veo).** Unified IAM, billing, quotas, audit logs. The Vertex AI service account never touches the client.
8. **Veo for video, Gemini for image.** Veo is purpose-built for short-form video, currently the most capable option for the "scene cinematic" use case. Gemini handles still illustrations. Both are Pro-tier; both are async.
9. **BetterAuth + SSO for major providers.** BetterAuth gives us OIDC integration to Google, Apple, GitHub, Microsoft, Discord without building OAuth flows ourselves; the BetterAuth ↔ Convex integration provides `ctx.auth` inside functions. Email + magic link is the universal fallback.
10. **In-house analytics, no PostHog or third-party trackers.** Per directive: events flow into a Convex `analytics_events` table; aggregations are Convex queries; the operator dashboard is a route in `apps/app/`. Trade-off: we build the funnel/retention queries ourselves (a few weeks of work). Accepted: zero data leaves the platform, simpler privacy story (no GDPR data-processor relationships beyond Stripe / Anthropic / Google), and the cost curve is flat instead of per-event.
11. **TypeScript everywhere, monorepo pnpm workspaces.** One source of truth for the engine's data model.
12. **Stripe-first billing with native IAP normalization.** Stripe is the primary subscription, invoice, customer portal, usage-meter, credit, upgrade, downgrade, cancellation, and tax-record system. Native IAP remains available on iOS/Android where store policy requires it, but receipts are verified server-side and normalized into Convex entitlements. Trade-off: we own more entitlement mapping than a billing-aggregator-first approach, but we get direct Stripe control for web conversion, overage opt-in, invoices, tax records, credits, customer portal, and later creator payouts.

## Known Limitations

- **Cold-start LLM latency** — even with the fastest model, the very first scene of a fresh session feels slow. Mitigated by showing the cover art and "the candle is being lit…" copy during the first stream.
- **Pro-tier image latency** — image generation is multi-second. Debounced to "after the scene is read" (background generate) and cached aggressively. Not a blocker for free / Unlimited tiers.
- **Pro-tier video latency** — Veo is meaningfully slower than image generation; reserved for chapter beats and death cinematics, pre-fetched when the engine predicts a beat is near. Won't appear inline mid-turn.
- **Convex egress + cold-region latency** — Convex deployments are regional. International players will see modest extra latency until Convex offers multi-region or we front it with our own edge.
- **Co-op remote rooms are day-one scope.** Convex's reactive model lets every reader subscribe to the same room/save projection; pass-the-controller and remote vote/pass arbitration are included in the V1 design.
- **Engine evolution vs. saved state.** As the engine grows, old saves may reference renamed fields. We'll need a save-migration framework (schema version per save row, registered upgrade functions) — defer until the engine schema actually has to break.
- **No designer authoring tool yet.** Starter adventures hand-authored as TS/JSON in `packages/stories/` until a separate authoring surface ships.
- **In-house analytics MVP** — funnel/retention queries are bespoke; we'll lack the depth of a mature product-analytics platform for a while.
