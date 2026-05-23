# Tasks Document - Core Read Loop / Full V1 App

> Status note: Tasks 1-25 track the V1 implementation scaffold and local/mock-verified product surface.
> They do not mean the product is ready for real credentials, paid provider traffic, app-store submission,
> or production deployment. The launch-readiness tracker at the end of this file is the source of truth
> for remaining P0 work before real keys and production traffic.

- [x] 1. Bootstrap the pnpm monorepo and shared build tooling
  - Files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, workspace package configs
  - Create the root workspace for `apps/app`, `packages/engine`, `packages/stories`, `packages/shared`, `convex`, and `infra`
  - Add baseline scripts for lint, typecheck, test, dev, build, Convex codegen/deploy, Expo web export, and CI entrypoints
  - Purpose: Establish the repo shape required by steering before feature teams branch into parallel work
  - _Leverage: `.spec-workflow/steering/structure.md`, `.spec-workflow/steering/tech.md`_
  - _Requirements: 13.1, 28.4_
  - _Prompt: Role: Monorepo platform engineer | Task: Bootstrap the CYOA pnpm workspace exactly to the approved steering structure, including root package scripts, TypeScript base config, package boundaries, and placeholder package manifests | Restrictions: Do not implement feature logic, do not introduce a framework outside approved tech, preserve dependency direction apps/convex/infra to packages only | Success: `pnpm install`, `pnpm typecheck`, and `pnpm test` have valid workspace targets and the repo has the approved directory skeleton_

- [x] 2. Implement shared Zod contracts and policy types
  - Files: `packages/shared/src/api/*`, `packages/shared/src/auth/*`, `packages/shared/src/content/*`, `packages/shared/src/billing/*`, `packages/shared/src/analytics/*`, `packages/shared/src/env/*`
  - Define request/response schemas, `AgeBand`, entitlement tiers, mature/safety policy results, analytics events, provider names, billing usage meters, co-op projections, tale metadata, and env schemas
  - Add unit tests for all schema parse and reject paths
  - Purpose: Give Convex and client teams one contract layer before implementation
  - _Leverage: design data models, `structure.md` shared package rules_
  - _Requirements: 1.2, 5.6, 11.1, 12.1, 15.7, 17.3, 20.6, 21.6_
  - _Prompt: Role: TypeScript contracts engineer | Task: Create shared Zod schemas and inferred types for all cross-layer CYOA V1 APIs, content policies, billing, analytics, co-op, publishing, and env validation | Restrictions: No Convex imports, no React imports, no provider SDK imports, no deep package imports | Success: schemas compile, tests cover valid and invalid payloads, and downstream packages can import only public barrels_

- [x] 3. Build the pure game engine package
  - Files: `packages/engine/src/types.ts`, `state.ts`, `apply.ts`, `visibility.ts`, `delayed.ts`, `death.ts`, `flags.ts`, `inventory.ts`, `stats.ts`, `modes.ts`, `endings.ts`, `migrations.ts`, `index.ts`
  - Implement initial state, choice visibility, choice application, node entry, auto-modifiers, delayed consequences, inventory and stat effects, death routing, endings, Story/Hardcore mode rules, structured diffs, and migration hooks
  - Add import-boundary lint rules that prevent I/O, Convex, React, Expo, provider SDKs, global clocks, and unpassed randomness in `packages/engine`
  - Purpose: Make the Game Spec executable and auditable
  - _Leverage: design Engine Package section, `structure.md` engine rules_
  - _Requirements: 4.1-4.7, 5.2-5.3, 7.1-7.3, 8.1-8.6, 10.1-10.5, 13.1-13.6, 29.1_
  - _Prompt: Role: Pure TypeScript engine engineer | Task: Implement the server-authoritative CYOA engine as a standalone package with deterministic functions and structured JSON diffs | Restrictions: No I/O, no React, no Convex, no LLM, no Date.now, no process.env, no console logging, no random globals; all clocks and RNG seeds must be passed in | Success: engine public API matches design, all core Game Spec behaviors are implemented, and package boundary checks fail on forbidden imports_

- [x] 4. Test the engine as the executable spec
  - Files: `packages/engine/tests/*`, package test config
  - Cover branching, locked/hidden choices, global flags, vitality death routing, currency, inventory key checks, hidden stats, auto-modifiers, delayed consequences, modes, endings, diffs, and migrations
  - Purpose: Protect the core rules before Convex and client depend on them
  - _Leverage: requirements coverage mandate and engine purity rules_
  - _Requirements: 7.1-7.3, 8.1-8.6, 10.1-10.5, 13.3-13.6, 29.4_
  - _Prompt: Role: Engine QA engineer | Task: Write high-coverage Vitest tests that make the Game Spec executable, including success, failure, edge, and migration cases | Restrictions: Do not mock engine internals, do not use nondeterministic clocks or random values, do not test Convex or client behavior here | Success: required engine modules meet the approved coverage target and every Game Spec behavior has at least one focused test_

- [x] 5. Create starter story data and story validation
  - Files: `packages/stories/src/training-room/*`, `bone-cathedral/*`, `iron-court/*`, `ashfall/*`, `validate.ts`, `index.ts`, story tests
  - Author `training-room` tutorial with at least three rooms, inventory keys, stat-changing choices, hidden-stat influence, auto-modifier, delayed consequence, one death ending, and one escape ending
  - Stub and validate the three additional starter adventures with metadata, safety profile, media policy, endings registry, and launchable seed structure
  - Purpose: Provide real story fixtures for engine, Convex, and UI work
  - _Leverage: `packages/engine` types, design Stories Package section_
  - _Requirements: 2.1-2.5, 10.1-10.5, 26.1-26.3_
  - _Prompt: Role: Interactive fiction content engineer | Task: Implement starter adventure data and validators using engine types, with safety-safe seeds and complete tutorial mechanics | Restrictions: Story modules are data only, no API calls, no React, no Convex, no mature content in default starter stories | Success: all stories validate against engine schemas, tutorial covers required mechanics, and tests prove launchability and ending reachability_

- [x] 6. Define Convex schema, indexes, and data access foundations
  - Files: `convex/schema.ts`, `convex/lib/authz.ts`, `convex/lib/ids.ts`, `convex/lib/errors.ts`, `convex/lib/projections.ts`
  - Create tables and indexes for accounts, entitlements, usage meters, saves, scenes, turn history, endings, published tales, tale reads/forks, authored seeds, seasons, leaderboards, co-op rooms, analytics events, daily counters, assets, migrations, and idempotency records
  - Add shared authorization helpers and safe projection helpers
  - Purpose: Create the server-owned data model all feature modules share
  - _Leverage: design Data Models, shared contracts_
  - _Requirements: 1.8, 5.8, 14.1-14.5, 15.2, 16.3, 17.3, 20.6, 21.1, 24.5, 29.1_
  - _Prompt: Role: Convex backend architect | Task: Implement the Convex schema, indexes, typed helper functions, authorization helpers, and projection helpers for the full V1 app | Restrictions: Do not expose raw account rows to client queries, validate args at boundaries, keep mutations short and transactional | Success: schema supports all approved data models, queries can be scoped by account/guest/room membership, and projections exclude private fields_

- [x] 7. Implement age-gated guest sessions and account claiming
  - Files: `convex/account.ts`, `convex/auth.config.ts`, `convex/crons.ts`, `apps/app/hooks/useAccount.ts`
  - Implement guest creation with age band only, under-13 rejection, token hashing, guest TTL purge, BetterAuth account claiming, SSO provider config, account export, account deletion, and mature-content setting mutation
  - Purpose: Make identity, age, and privacy constraints server-authoritative
  - _Leverage: shared auth/content schemas, Convex schema_
  - _Requirements: 1.1-1.11, 12.1-12.8, 16.1-16.5_
  - _Prompt: Role: Auth and privacy backend engineer | Task: Build age-gated guest sessions, BetterAuth account claiming, export/delete, and mature opt-in server actions | Restrictions: Store only age band, never date of birth; block under-13 before session/save creation; hash guest tokens; do not expose private account fields | Success: guests can be created only after eligible age selection, claimed accounts preserve data, deletion/export work, and mature opt-in is allowed only for paid authenticated 18-plus users_

- [x] 8. Implement saves, migrations, endings, and reactive read queries
  - Files: `convex/saves.ts`, `convex/endings.ts`, `convex/migrations.ts`, `apps/app/hooks/useSave.ts`
  - Implement save creation, current scene query, server snapshot projection, story/hardcore mode rules, rewind/bookmark hooks where applicable, ending unlocks, endings map data, trophy crypt data, and atomic save migrations
  - Purpose: Provide reliable read state independent of LLM orchestration
  - _Leverage: engine package, stories package, shared contracts_
  - _Requirements: 2.2-2.5, 3.1-3.7, 6.1-6.7, 10.1-10.5, 14.1-14.5, 19.1-19.5, 29.1-29.4_
  - _Prompt: Role: Convex state engineer | Task: Implement save lifecycle, reactive read projections, endings persistence, and migration support using the pure engine package | Restrictions: Client-visible data must be projected, migrations must be atomic and non-destructive on failure, client cannot provide canonical state | Success: save queries mirror server truth across reloads/tabs, endings are recorded and queryable, and old save fixtures migrate safely_

- [x] 9. Implement narrative safety and mature-content gates
  - Files: `convex/safety.ts`, `convex/contentPolicy.ts`, `convex/llm/promptGuards.ts`, `packages/shared/src/content/*`, safety tests
  - Implement pre-prompt, post-generation, pre-publish, pre-fork, media, and co-op content checks
  - Block self-harm, suicide, depressive hopelessness, and player-directed despair for everyone; build safe redirection and safe ending scenes when content approaches a trigger
  - Gate adult language, adult subject matter, and adult imagery behind authenticated paid `18+` explicit opt-in
  - Purpose: Enforce the app's strongest trust invariant
  - _Leverage: design Safety and Mature Content Gate section_
  - _Requirements: 11.1-11.8, 12.1-12.8, 15.6, 20.7, 21.6, 24.5_
  - _Prompt: Role: Trust and safety backend engineer | Task: Implement content policy classification, safe closure generation, mature-content gating, and redacted analytics hooks across generation, publishing, forking, media, and co-op | Restrictions: Mature opt-in never unlocks self-harm, suicide, depressive hopelessness, or player-directed despair; unsafe raw text must not be logged; safety must run before persistence and rendering | Success: unsafe content is redirected or ended safely, mature content is blocked unless all eligibility checks pass, and tests cover boundary cases_

- [x] 10. Implement LLM provider router, parsing, memory, and streaming
  - Files: `convex/llm/router.ts`, `anthropic.ts`, `vertex.ts`, `deepseek.ts`, `parse.ts`, `providerPolicy.ts`, `prompts/*`, `convex/memory.ts`, `convex/http.ts`
  - Add provider roles for Anthropic quality-first, Vertex Gemini fallback, DeepSeek cost-optimized eligible text, and deterministic fallback
  - Implement prompt construction, memory-window retrieval, stream handling, parser retry, provider fallback, provider health, token usage capture, and redacted failure metadata
  - 2026-04-30 update: Scene prose budgets are now typed as `brief`, `standard`, `rich`, or `chapter` and flow from story/node metadata into `SceneGenerationRequest` and provider prompts.
  - 2026-04-30 update: Main gameplay now uses a two-step streaming lifecycle: `game.beginStreamingChoice` creates the authoritative pending scene, `/llm/scene-stream` derives a canonical server-side `SceneGenerationRequest`, streams SSE tokens, and persists or fails the scene through completion/failure mutations.
  - Purpose: Make providers swappable without giving them state authority
  - _Leverage: shared schemas, safety gates, design LLM Provider Router section_
  - _Requirements: 5.4-5.9, 9.1-9.7, 11.1-11.8, 15.1-15.6, reliability NFR_
  - _Prompt: Role: LLM systems engineer | Task: Implement the Convex LLM provider router, provider wrappers, prompts, Zod parsing, memory retrieval, SSE streaming, fallback, and deterministic fallback | Restrictions: LLM output is prose and display metadata only; no provider may mutate engine state; DeepSeek may run only when policy marks the turn low-risk and eligible; all provider output must pass parser and safety gates | Success: turn prose streams, provider fallback works, parsing failures degrade safely, and provider selection is observable_

- [x] 11. Implement the turn orchestrator and idempotent read loop
  - Files: `convex/turn.ts`, `convex/http.ts`, `convex/ratelimit.ts`, turn integration tests
  - Implement `turn.submit`, mutation locks, request-id idempotency, daily turn checks, engine-before-LLM state transition, death/no-LLM branch, streaming, post-generation persistence, turn history, analytics, and duplicate submission handling
  - Purpose: Deliver the core gameplay loop
  - _Leverage: engine, stories, safety, LLM router, saves, billing/ratelimit_
  - _Requirements: 5.1-5.9, 6.2-6.7, 7.1-7.3, 14.1-14.5, 15.1-15.7, 17.1-17.2_
  - _Prompt: Role: Convex read-loop engineer | Task: Implement the full idempotent turn orchestration path from choice submission through engine effects, LLM streaming, safety checks, persistence, analytics, and reactive updates | Restrictions: Engine runs before LLM, death branches must not call LLM, duplicate submissions must not double-apply choices, all state changes must be server-authoritative | Success: happy path, death path, safety path, provider failure path, daily-limit path, and duplicate-request path pass integration tests_

- [x] 12. Implement Stripe-first billing, entitlements, credits, and overage controls
  - Files: `convex/billing/stripe.ts`, `entitlements.ts`, `paywall.ts`, `nativeReceipts.ts`, `apple.ts`, `google.ts`, `convex/ratelimit.ts`, billing tests
  - Implement Stripe checkout, customer portal, webhooks, idempotent event handling, plan previews/proration, usage meters, credit packs, overage opt-in, spend caps/thresholds, daily turns, Unlimited/Pro entitlements, and native receipt normalization where required
  - Purpose: Monetize without surprise charges and keep entitlements cross-platform
  - _Leverage: shared billing schemas, design Billing and Entitlements section_
  - _Requirements: 12.2-12.8, 17.1-17.8, 24.1-24.5, 25.3_
  - _Prompt: Role: Billing platform engineer | Task: Build Stripe-first billing and entitlement infrastructure with native receipt normalization, credits, metered usage, plan previews, and no-surprise overage controls | Restrictions: Verify Stripe webhook signatures, enforce webhook idempotency, never store raw payment details, do not grant entitlements before confirmed server-side payment or receipt verification | Success: subscriptions, upgrades, credits, usage, spend caps, native receipts, and mature paid prerequisites are represented in Convex entitlements and covered by tests_

- [x] 13. Build the Expo app shell, theme system, and design primitives
  - Files: `apps/app/app/_layout.tsx`, `apps/app/theme/*`, `apps/app/components/primitives/*`, `apps/app/lib/*`
  - Implement Convex/Auth/Theme providers, route guard hooks, Day/Night/Sepia tokens, typography settings, core primitives mapped from the design bundle, accessibility defaults, and reduced-motion support
  - Purpose: Establish the client foundation before reader/product routes
  - _Leverage: `design-bundle/project/primitives.jsx`, `sketch.css`, design UI Design System_
  - _Requirements: 3.6, 18.1-18.5, accessibility NFR_
  - _Prompt: Role: Expo design-system engineer | Task: Build the Expo Router shell, providers, theme tokens, typography controls, and reusable primitives matching the approved design bundle vocabulary | Restrictions: Use React Native compatible components, no nested decorative cards, keep text readable/responsive, do not add marketing landing pages | Success: primitives are reusable, accessible, themed, native-compatible, and covered by component tests_

- [x] 14. Build age gate, landing, library, and tutorial launch flows
  - Files: `apps/app/app/index.tsx`, `apps/app/app/library/*`, `apps/app/components/account/AgeGate.tsx`, `apps/app/hooks/useGuestSession.ts`, `apps/app/hooks/useLibrary.ts`
  - Implement age selector with under-13 block, guest bootstrap, cover CTA, continue CTA, starter adventure library, and tutorial save launch
  - Purpose: Make first visit playable without signup while enforcing age before session creation
  - _Leverage: account Convex functions, library/story queries, design entry surfaces_
  - _Requirements: 1.1-1.11, 2.1-2.5, 26.1-26.3_
  - _Prompt: Role: Product frontend engineer | Task: Implement the first-run age gate, guest bootstrap, landing cover, library, and tutorial launch flows | Restrictions: Do not default age to an eligible value, do not create guest session for under-13 users, keep signup optional before the hook | Success: eligible users can start or continue the tutorial quickly, under-13 users are blocked before save/session creation, and library cards render starter adventures_

- [x] 15. Build reader, choices, prose stream, stats HUD, death, and media components
  - Files: `apps/app/app/read/[saveId]/*`, `apps/app/components/reading/*`, `choices/*`, `stats/*`, `death/*`, `media/*`, `apps/app/hooks/useTurn.ts`, `useStreamingScene.ts`
  - Implement `Read_Book` default, mobile layout, prose streaming, choice cards, locked-choice hints, optimistic disabled states, stat pips, peek drawer, inventory overlay, death/ending screen, illustration fader, and Veo cinematic shell
  - Purpose: Deliver the core player-facing read loop
  - _Leverage: design reader/stats/death boards, Convex turn/read queries_
  - _Requirements: 3.1-3.7, 4.1-4.7, 5.1, 6.1-6.7, 10.1-10.5, 14.1-14.5, 24.1-24.4_
  - _Prompt: Role: Reader experience frontend engineer | Task: Build the CYOA reader surface with streaming prose, choices, stats feedback, inventory, endings/death, and async media display | Restrictions: Client mirrors server state only, no local engine authority, no raw HTML rendering, respect reduced motion and accessibility labels | Success: first choice flow shows streamed prose, locked choices, stat pips, reactive updates across tabs, death/end screens, and nonblocking media_

- [x] 16. Build settings, endings map, trophy crypt, account, and paywall routes
  - Files: `apps/app/app/settings/*`, `map/[saveId]/*`, `endings/*`, `account/*`, `paywall/*`, `apps/app/components/paywall/*`, `apps/app/components/endings/*`
  - Implement reader settings persistence, layout/HUD modes, endings graph, trophy crypt, account sign-in/claim UI, subscription management, daily-limit paywall, credit/overage controls, and Stripe portal links
  - Purpose: Complete the core retention and monetization surfaces around the read loop
  - _Leverage: Convex settings/saves/endings/billing functions, design meta/paywall boards_
  - _Requirements: 16.1-16.5, 17.1-17.8, 18.1-18.5, 19.1-19.5_
  - _Prompt: Role: Product surfaces frontend engineer | Task: Implement settings, endings, account, and paywall screens with Convex-backed persistence and Stripe-first billing interactions | Restrictions: Do not show adult/mature controls to ineligible users as available; plan changes require server preview before confirmation; hidden endings must not reveal hidden paths | Success: users can claim accounts, tune reading, see endings, hit a graceful paywall, upgrade, manage subscription, and control overage opt-in_

- [x] 17. Implement co-op rooms and remote-room UI
  - Files: `convex/coop.ts`, `apps/app/app/coop/*`, `apps/app/components/coop/*`, co-op tests
  - Implement create/join room, hashed invite tokens, token rotation, pass mode, vote mode, spectator mode, host recovery, participant removal, room close, projected participant records, mature-room eligibility checks, and reactive UI
  - Purpose: Support local and remote shared reading without leaking private account data
  - _Leverage: design Co-op section, save/read projections, safety gates_
  - _Requirements: 20.1-20.7, 15.7, 12.6-12.8_
  - _Prompt: Role: Realtime collaboration engineer | Task: Build Convex co-op rooms and Expo co-op UI for pass-the-controller, voting, spectators, invite rotation, host recovery, and mature-room eligibility | Restrictions: Participants see only projected display/presence/vote/read state, never email, billing source, mature settings, private saves, unrelated endings, or analytics identifiers | Success: host and participant can complete a remote vote/pass turn, leaked invites can be rotated, disconnects recover, and mature rooms enforce every participant's eligibility_

- [x] 18. Implement publishing, read-along, forking, creator seeds, seasons, and achievements
  - Files: `convex/tales.ts`, `convex/creator.ts`, `convex/seasons.ts`, `apps/app/app/publish/[saveId]/*`, `tale/[taleId]/*`, `creator/*`, `seasons/*`
  - Implement immutable tale snapshots, privacy modes, revocation, read-only public/unlisted/friends views, fork from decision, creator seed authoring/publishing, play-time attribution events, active season, achievements, and leaderboards
  - Purpose: Build the sharing, creator, and recurring engagement loops
  - _Leverage: safety gates, engine/story validation, analytics events_
  - _Requirements: 21.1-21.6, 22.1-22.5, 23.1-23.4_
  - _Prompt: Role: Social and creator backend/frontend engineer | Task: Implement published tales, read-along, forking, creator seeds, seasons, achievements, and leaderboards across Convex and Expo routes | Restrictions: Publishing/forking must re-run safety and mature gates; revocation must stop public URLs immediately; immutable turn snapshots must not be rewritten by metadata edits | Success: a player can publish, revoke, read, and fork a tale; a creator can publish a validated seed; seasons and achievements record without revealing hidden unsafe paths_

- [x] 19. Implement Pro media and ambient sound orchestration
  - Files: `convex/media/imagen.ts`, `convex/media/veo.ts`, `convex/media/audio.ts`, `convex/assets.ts`, `apps/app/components/media/*`, media tests
  - Schedule Vertex image/video jobs asynchronously, persist asset provenance/safety, mirror to storage/CDN where configured, attach ready assets reactively, and implement ambient loops with mute/reduced-motion/native background behavior
  - Purpose: Add Pro richness without blocking text reading
  - _Leverage: entitlement checks, safety gates, design Pro media requirements_
  - _Requirements: 12.4, 17.6-17.7, 24.1-24.5_
  - _Prompt: Role: Media systems engineer | Task: Implement async Pro image/video/audio orchestration with entitlement checks, safety classification, asset persistence, and nonblocking client display | Restrictions: Text streaming must never wait on media, generated media requires Pro entitlement and policy checks, reduced motion and mute settings must be respected | Success: qualifying Pro scenes queue media, text remains usable, assets appear when ready, failed/blocked jobs do not break the reader_

- [x] 20. Implement in-house analytics and admin dashboards
  - Files: `convex/analytics.ts`, `apps/app/app/admin/*`, `apps/app/components/admin/*`, analytics tests
  - Emit and aggregate activation, tutorial, signup, paywall, subscription, Pro upgrade, publish, co-op, cost, safety, live-read, fallback, latency, and error metrics
  - Build admin-gated funnel, cost, safety, and live dashboards
  - Purpose: Operate the app without third-party trackers
  - _Leverage: shared analytics schemas, design Operator Dashboard section_
  - _Requirements: 15.1-15.7, 27.1-27.5_
  - _Prompt: Role: Product analytics engineer | Task: Implement Convex analytics ingestion/aggregates and admin-only dashboards for funnel, cost, safety, billing, and live-read metrics | Restrictions: No third-party tracker scripts, no raw unsafe or mature text, no email/OAuth profile/raw payment data in analytics, admin claim required for all dashboards | Success: dashboard shows approved metrics reactively and tests prove privacy redaction and admin gating_

- [x] 21. Add local Docker development environment with production-like boundaries
  - Files: `docker-compose.yml`, `Dockerfile`, `docker/*`, `.env.example`, `scripts/dev/*`, `README.md`
  - Containerize the app dev server, Convex dev process or documented Convex dev deployment connection, provider mocks, optional fake object storage, Stripe CLI webhook forwarding, and seed-data scripts
  - Document what can be mirrored locally and what remains managed/sandboxed: Convex production runtime, Stripe live billing, Vertex/Anthropic/DeepSeek production calls, StoreKit/Play Billing, EAS build/submit, and real push notification delivery
  - Purpose: Give teams a reproducible local environment that mirrors contracts, data, and failure modes without pretending managed production can run fully offline
  - _Leverage: `tech.md` deployment model, design Bug and Security Scrub_
  - _Requirements: 28.1-28.5, 15.1-15.7, 17.3-17.8_
  - _Prompt: Role: Developer experience and platform engineer | Task: Build a Docker Compose local development environment with service containers, provider mocks, Stripe webhook sandboxing, seed data, and explicit production-boundary documentation | Restrictions: Do not commit real secrets, do not require live paid provider calls for default local development, do not claim local Docker exactly reproduces managed Convex/Stripe/Vertex production | Success: a new developer can run one documented command to start the web app plus backend/dev dependencies, seed tutorial data, receive local webhooks, and test provider failure modes_

- [x] 22. Implement infrastructure, CI/CD, secrets, and deployment automation
  - Files: `infra/*`, `.github/workflows/*`, `apps/app/app.json`, `README.md`
  - Implement Pulumi GCP project resources, Vertex access, storage/CDN/DNS, Secret Manager, monitoring, Convex deploy wiring, Expo web export deployment, EAS Build/Submit/Update configs, and GitHub Actions pipelines
  - Purpose: Make staging and production deployable and observable
  - _Leverage: `tech.md` Deployment and Distribution, `structure.md` infra section_
  - _Requirements: 25.1-25.5, 28.1-28.5_
  - _Prompt: Role: Infrastructure engineer | Task: Implement Pulumi, CI/CD, Convex deploy, Expo web/native deployment, secrets flow, monitoring, and environment docs | Restrictions: Secrets must come from Secret Manager or approved CI secrets, no secrets committed, native release config must separate dev/staging/prod channels | Success: CI runs lint/typecheck/tests/builds, staging deploy is repeatable, production resources are defined as code, and monitoring covers web, Convex errors, provider fallback spikes, and Vertex errors_

- [x] 23. Write end-to-end tests for critical user journeys
  - Files: `apps/app/e2e/*`, `tests/e2e/*`, Playwright config, test fixtures
  - Cover first visit, under-13 block, tutorial first choice, stat pip, duplicate turn, free limit to paywall to mocked subscribe, safety redirect/safe ending, mature gate, death to trophy crypt, account claim, co-op vote room, publish/read/fork, Pro media attach, admin dashboard
  - Purpose: Validate the product as one integrated app
  - _Leverage: testing strategy from design, local Docker environment_
  - _Requirements: All critical V1 requirements_
  - _Prompt: Role: E2E QA automation engineer | Task: Implement Playwright end-to-end coverage for the approved V1 critical journeys using deterministic fixtures, provider mocks, and mocked billing where appropriate | Restrictions: Tests must avoid live payments and live provider spend by default, must not assert implementation internals, must be reliable in CI | Success: E2E suite covers the listed journeys and runs locally and in CI against seeded data_

- [x] 24. Perform final security, privacy, performance, and accessibility hardening
  - Files: cross-cutting audit fixes across `packages/*`, `convex/*`, `apps/app/*`, `infra/*`
  - Audit authz scopes, invite token hashing, webhook signatures, idempotency, content redaction, mature eligibility, under-13 blocks, provider secret isolation, no HTML rendering, rate limits, spend caps, query projections, reduced motion, keyboard access, screen-reader labels, latency budgets, and engine import boundaries
  - Purpose: Close V1 risk before release tasks or implementation completion
  - _Leverage: design Bug and Security Scrub, NFR sections_
  - _Requirements: 1.11, 11.1-11.8, 12.1-12.8, 14.1-14.5, 15.7, 17.7-17.8, 20.6-20.7, 21.6, 27.1, NFR Security/Performance/Usability_
  - _Prompt: Role: Security, privacy, and accessibility reviewer | Task: Audit the implemented V1 app for authorization, privacy, content safety, billing safety, provider-secret safety, performance budgets, and accessibility, then patch concrete defects | Restrictions: Do not broaden scope into new features, do not weaken safety or mature gates for UX convenience, do not suppress failing tests without fixing root causes | Success: all critical security/privacy/accessibility checks pass, latency budgets are measured, and residual risks are documented_

- [x] 25. Final integration, documentation, and implementation logs
  - Files: `README.md`, package READMEs, `infra/README.md`, local dev docs, implementation logs
  - Update setup, Docker local environment, production deploy, provider setup, Stripe setup, safety policy, testing, and agent-team ownership docs
  - Run full lint, typecheck, unit, integration, E2E, and build verification
  - Record implementation artifacts with the implementation-log tool for each completed task/workstream
  - Purpose: Make the implementation maintainable for future agents and developers
  - _Leverage: spec workflow implementation logging requirements_
  - _Requirements: 28.4, all_
  - _Prompt: Role: Release integrator | Task: Complete final docs, verification, cleanup, and implementation logs for the full V1 app | Restrictions: Do not mark tasks complete without passing or explicitly documenting required verification, do not omit implementation artifacts from logs | Success: docs are usable, full verification status is clear, and implementation logs describe APIs, components, functions, classes, integrations, and files changed_

## Launch Readiness Tracker

These items are intentionally separate from the V1 scaffold tasks above. They must remain unchecked until they pass against real development/staging services with Vault-backed secrets. Local provider mocks and deterministic fixtures are not sufficient to mark these complete.

- [ ] LR-1. Wire Convex-backed BetterAuth runtime and session auth
  - Files: `convex/betterAuth/*`, `convex/http.ts`, `apps/app/lib/authClient.ts`, `apps/app/lib/authConfig.ts`, `docs/convex-auth.md`
  - Implement generated BetterAuth runtime files after Convex codegen, register BetterAuth HTTP routes, set `EXPO_PUBLIC_AUTH_MODE=better-auth`, and verify guest claim/sign-in/session restore through Convex identity.
  - Replace local-auth-only assumptions in account/profile flows with server-backed identity where required.
  - 2026-04-30 progress: BetterAuth runtime, `/api/auth/*` route registration, app BetterAuth mode switch, Convex token provider, user-row `ctx.auth` ownership guard, and guest-token proof for guest rows are implemented locally. Keep unchecked until HTTPS tunnel smoke verifies sign-up/sign-in/sign-out/reload/guest-claim against a configured Convex deployment.
  - Success: tunnel HTTPS sign-up/sign-in/sign-out/guest-claim works on a clean browser and across reloads; Convex `ctx.auth` gates account-owned functions; local auth remains development-only.

- [ ] LR-2. Replace temporary LLM stream secret with account/save authorization
  - Files: `convex/http.ts`, `convex/saves.ts`, `convex/lib/authz.ts`, `apps/app/hooks/useTurn.ts`, `docs/local-docker.md`
  - Current `/llm/scene-stream` is guarded by account/save authorization and current pending-scene validation through `game.getAuthorizedSceneStreamRequest`; the old `LLM_STREAM_SECRET` env has been removed from app env contracts and Vault allowlists.
  - 2026-04-30 progress: `/llm/scene-stream` parses account/save identity, calls a Convex authorization query before provider work, refuses non-pending scene requests, builds the provider request server-side, persists streamed prose via `game.completeSceneStream`, and clears pending locks through `game.failSceneStream` on provider failure. Keep unchecked until live Convex HTTP smoke confirms unauthenticated direct calls fail and authorized calls stream tokens.
  - Success: direct unauthenticated calls return 401/403; authorized reads stream tokens; provider spend cannot be triggered for another user's save.

- [ ] LR-3. Validate live Anthropic, Vertex/Gemini, and DeepSeek calls
  - Files: `convex/llm/*`, `scripts/secrets/*`, `docs/vault.md`, `docs/local-docker.md`
  - Sync real provider keys/tokens from Vault into a Convex dev deployment.
  - Run smoke tests for Anthropic quality route, Vertex fallback route, DeepSeek low-risk route, parse failure fallback, provider outage fallback, timeout behavior, and no-state-mutation parsing.
  - 2026-04-30 note: Provider clients, request validation, prompt construction, fallback, and local provider mocks are implemented and tested. Keep unchecked until Vault-backed live credentials are synced and live calls are smoke-tested through the configured deployment.
  - 2026-05-15 progress: `scripts/smoke/live-llm.mjs` (pnpm smoke:live-llm) added — probes Anthropic/Vertex/Gemini/DeepSeek with non-spending 10-token prompts, auto-skips per-provider when keys absent, scrubs sk-* / Bearer tokens from any error logging. Use `--require anthropic,vertex,deepseek` to enforce all three in CI once Vault syncs real keys.
  - Success: live calls produce persisted/streamed prose, provider health reflects config, unsafe output is redacted/falls back, and no provider credentials appear in logs or client bundles.

- [ ] LR-4. Stripe test-mode checkout and webhook entitlement pass
  - Files: `convex/billing/*`, `convex/billingFunctions.ts`, `convex/http.ts`, `apps/app/app/paywall/*`, `docs/stripe-mobile.md`
  - Sync Stripe test keys and price IDs from Vault, create a Checkout session, complete test payment, forward webhook through Stripe CLI, and verify entitlement changes are server-confirmed and idempotent.
  - 2026-05-15 progress: `scripts/smoke/live-stripe.mjs` (pnpm smoke:live-stripe) added — validates sk_test_ key against /v1/payment_methods, well-forms a t=…,v1=… signature header from whsec_, and resolves STRIPE_PRICE_UNLIMITED/PRO against the live API. Live keys (non-test) explicit-fail to prevent prod-mode runs.
  - Success: free -> Unlimited/Pro test upgrade updates Convex entitlements; duplicate webhook events are ignored; paywall UI never grants access before server confirmation.

- [ ] LR-5. Replace native receipt placeholders
  - Files: `convex/billing/apple.ts`, `convex/billing/google.ts`, `convex/billing/nativeReceipts.ts`, `docs/stripe-mobile.md`, `eas.json`
  - Replace local transaction-id placeholder verification with App Store Server API and Google Play Developer API validation.
  - Store App Store Connect and Google Play credentials in Vault and verify sandbox receipts before app-store submission.
  - 2026-04-30 progress: Native receipt helpers no longer accept non-empty transaction ids as proof. They validate store-returned Apple transaction and Google subscription records for transaction/purchase-token match, product id, account binding, expiry, revocation/inactive state, and bundle/package identity. Keep unchecked until sandbox API calls run with Vault-backed store credentials.
  - Success: verified sandbox receipts normalize to the shared entitlement model; malformed, replayed, expired, and cross-account receipts are rejected.

- [ ] LR-6. Implement explicit Convex seed/import command
  - Files: `scripts/dev/seed-local.mjs`, `convex/seeds.ts`, `convex/creatorFunctions.ts`, `convex/game.ts`, `packages/stories/*`, `docs/local-docker.md`
  - Replace the documented seed placeholder with a Convex mutation/action that imports starter stories or validates that package-owned starter data is already addressable by the live backend.
  - 2026-04-30 progress: `seeds:loadStarterStories` now validates the package-owned starter catalog through Convex, `scripts/dev/seed-local.mjs` calls that mutation, published creator seeds are listed from Convex in the library, and launching `authored_seed:<seedId>` creates a normal remote save. Keep unchecked until the seed command is run against a clean configured Convex dev deployment.
  - Success: a clean Convex dev deployment can be bootstrapped without hand-editing tables, and the library shows expected starter adventures.

- [ ] LR-7. Production/staging deployment rehearsal
  - Files: `infra/*`, `.github/workflows/*`, `cloudflare/*`, `docs/vault.md`, `README.md`
  - Replace placeholder Pulumi stack config with real project IDs/domains, sync Vault secrets, deploy Convex, export web, publish hosting assets, and verify monitoring.
  - 2026-05-15 progress: `docs/deployment.md` shipped — staging deploy sequence (Vault sync → convex:deploy → web export → smoke:live-readiness → live-llm → stripe trigger), production promotion gates, rollback paths for Convex/web/EAS, monitoring pointers. The Pulumi `infra/*` stack still needs real project IDs/domains plus a staging URL before this runbook can execute.
  - Success: staging URL over HTTPS passes health checks, app loads without local-only env, provider fallback alerts are wired, and rollback steps are documented.

- [ ] LR-8. Native build, signing, submit, and push validation
  - Files: `apps/app/app.json`, `eas.json`, `docs/stripe-mobile.md`, `docs/vault.md`
  - Run Vault-backed EAS build for iOS and Android, validate signing profiles, submit dry run where possible, and verify push notification permission/delivery path if enabled.
  - 2026-05-15 progress: `docs/eas-preflight.md` shipped — Apple/Google Vault prereqs, app.json/eas.json pre-flight checklist, signing+credentials walkthrough, native receipt verification step, EAS Update rollback path, sign-off via `pnpm smoke:launch-verify --require-llm ... --require-stripe`. Awaiting Apple Developer + Google Play credentials in Vault before the build can run.
  - Success: development/staging native builds install and authenticate, native billing sandbox is testable, and release-channel separation is verified.

- [ ] LR-9. Final launch verification bundle
  - Files: `README.md`, `docs/*`, `.spec-workflow/specs/core-read-loop/Implementation Logs/*`
  - Run and record: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm audit --audit-level moderate`, `pnpm secrets:local:check`, live provider smoke, Stripe webhook smoke, BetterAuth tunnel smoke, and deployment smoke.
  - 2026-04-30 progress: `pnpm smoke:live-readiness` now provides a non-spending HTTPS smoke for app HTML, BetterAuth route mount, Stripe webhook mount, and unauthorized LLM stream rejection.
  - 2026-05-15 progress: `scripts/smoke/launch-verify.mjs` (pnpm smoke:launch-verify) orchestrates typecheck + test + secrets-check + live-llm + live-stripe + (optional) live-readiness, then emits a dated Markdown log under .spec-workflow/specs/core-read-loop/Implementation Logs/lr-9_<stamp>_launch-verify.md. First dry run logged at lr-9_2026-05-16T0413_launch-verify.md: 4 PASS, 1 FAIL-allowed (the pre-existing llmRouter assertion). Live-only steps SKIP cleanly when keys are absent.
  - Success: every command has a dated implementation log entry with environment, exact command, result, residual risk, and owner for any deferred item.

---

## Wave 0 — Visual Design Hardening (added)

These tasks fold the hi-fi design pass into production. They follow tasks 1-25 (all marked complete) and reference the assets shipped at `apps/app/assets/design/`.

- [x] 26. Wire token file as the single source of theme values
  - Files: `apps/app/theme/tokens.ts` (generated or hand-mirrored from `apps/app/assets/design/tokens/tokens.json`), `apps/app/theme/themes.ts`, `apps/app/theme/fonts.ts`, theme tests
  - 2026-05-11 progress (Foundation agent, commit ea8b900, merged into feat/visual-design-wave-0): Token module wired from JSON via theme/tokens.generated.ts + themes.ts; canonical sepia/night/day with parchment/midnight back-compat; node:test drift check at theme/__tests__/tokens.test.mjs. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Replace any inline hex colors, font names, or spacing constants in `apps/app/theme/` and `apps/app/components/primitives/` with imports from the generated token module
  - Add a build-time check (lint rule or codegen diff) that fails CI if `apps/app/theme/tokens.ts` drifts from `apps/app/assets/design/tokens/tokens.json`
  - Wire the three canonical themes `sepia`, `night`, `day` and keep `parchment`/`midnight` as resolving aliases for one release cycle, then remove
  - Purpose: Make the token file the single source of truth and prevent silent drift
  - _Leverage: `apps/app/assets/design/tokens/tokens.json`, `apps/app/assets/design/tokens/tokens.css`_
  - _Requirements: 18.1, 30.1, 30.2, 30.4_
  - _Prompt: Role: Design-systems frontend engineer | Task: Replace inline color/font/spacing constants in the Expo theme with imports from a token module sourced from `apps/app/assets/design/tokens/tokens.json`, wire the three canonical themes, and add a CI drift check | Restrictions: Do not introduce new tokens not present in the JSON, do not reference primitive scales from components, keep back-compat alias names resolving for one release | Success: production components reference only semantic aliases, theme switch covers `sepia`/`night`/`day`, and CI fails when the theme module drifts from the JSON_

- [x] 27. Lift production iconography, logos, covers, and marketing assets
  - Files: `apps/app/components/icons/*` (16 components mapping to `apps/app/assets/design/icons/`), `apps/app/components/brand/Logo.tsx`, `apps/app/app.json` (favicon/icon/splash references), library card cover wiring
  - 2026-05-11 progress (Foundation agent, commit ea8b900, merged into feat/visual-design-wave-0): 16 icon components under components/icons/ (SvgIcon + 16 named), brand/Logo.tsx with wordmark/lockup/glyph/seal variants, app.json points at apps/app/assets/design/marketing/ and logos/. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the 16 icon components rendering the SVGs from `apps/app/assets/design/icons/` at `currentColor`
  - Wire library cards (Requirement 26.1) to load the four starter-tale covers from `apps/app/assets/design/covers/` by id
  - Replace any inline SVG re-creation of the wordmark or candle glyph with imports of the shipped assets from `apps/app/assets/design/logos/`
  - Point `apps/app/app.json` `icon`, `splash`, `android.adaptiveIcon`, and `web.favicon` at the canonical files in `apps/app/assets/design/marketing/` and `apps/app/assets/design/logos/`
  - Purpose: Match approved hi-fi visual identity in production without regenerating shapes
  - _Leverage: `apps/app/assets/design/{icons,logos,covers,marketing}/`_
  - _Requirements: 26.1, 30.6, 30.7, 30.8_
  - _Prompt: Role: Frontend asset integration engineer | Task: Build typed icon components for the 16-icon set, wire library covers, replace any inline regenerated brand SVG with imports of the shipped logos, and point app.json at the canonical marketing/logo assets | Restrictions: Do not redraw shapes, keep file names stable so the asset map matches the canvas, ensure icons render at currentColor | Success: every icon in the 16-set has a typed component, library cards render the four covers, brand mark is sourced from `apps/app/assets/design/logos/`, and app.json points at the canonical marketing assets_

- [x] 28. Implement the MediaPlate upgrade pattern
  - Files: `apps/app/components/media/MediaPlate.tsx`, `MediaPlate.skeleton.tsx`, `MediaPlate.image.tsx`, `MediaPlate.video.tsx` (deleted in 816437d), `SceneCinematic.tsx` (added in 816437d), `apps/app/hooks/useMediaPlate.ts`, MediaPlate tests
  - 2026-05-11 progress (MediaPlate agent, commit 647f4bf, merged into feat/visual-design-wave-0): components/media/MediaPlate{,.skeleton,.image,.video}.tsx + useMediaPlate.ts pure reducer; SceneMedia.tsx now thin wrapper; reduced-motion short-circuits videoBuffering/playing back to image; 12 vitest cases via apps/app/vitest.config.ts; existing convex/tests/media.test.ts still green. pnpm typecheck green offline; no Convex cloud calls.
  - 2026-05-21 follow-up (commit 816437d): Four-state pattern now spans two slots, not one crossfading plate (see design.md "MediaPlate Upgrade Pattern" refinement). MediaPlate owns states 1–2 (Skeleton → Image) above the prose; new SceneCinematic owns states 3–4 (Veo buffering → playing) below the prose. MediaPlate.video.tsx removed; useMediaPlate state collapses to idle|skeleton|image; SceneMedia.tsx coordinates both slots. Book / GraphicNovel / Mobile / ModernApp layouts plumb both slots independently; Journal intentionally renders SceneCinematic only (no image plate, per canvas § 19 D). Reduced-motion / Veo-failure semantics preserved (SceneCinematic returns null and the image plate remains). MediaPlate.state.test.ts simplified to match the narrower state machine.
  - Implement the four states (Skeleton, Image ready, Video buffering, Video playing) per design.md "MediaPlate Upgrade Pattern"
  - Crossfade timing matches the canvas: ≤3s typical to image, image stays as poster frame for Veo failure or reduced motion
  - Honor reduced motion: stay on state 2 permanently
  - Wire reactive Convex asset query so transitions happen as ready/failed events arrive
  - Purpose: Deliver the asynchronous Pro media UX the design doc and Requirement 24 require
  - _Leverage: `convex/media/imagen.ts`, `convex/media/veo.ts`, `convex/assets.ts`, `apps/app/assets/design/design-system.html` § 24A (Frames overview) and § 24B (Playback model)_
  - _Requirements: 24.1-24.5, 30.9, 18.5_
  - _Prompt: Role: Reader media frontend engineer | Task: Build the MediaPlate component with the four upgrade states, reactive asset wiring, reduced-motion handling, and Veo-failure fallback to image | Restrictions: Text streaming must not block on media, reduced-motion users must never see autoplaying video, Veo failure must not break the reader | Success: MediaPlate renders all four states from real Convex asset events, reduced-motion users stop at image, Veo failure falls back to image, and tests cover each transition_

- [x] 29. Visual regression baseline against the design canvas
  - Files: `tests/visual/*`, Playwright + pixelmatch config, baseline screenshots from `apps/app/assets/design/design-system.html`
  - 2026-05-11 progress (commit 5876cc8 + visual scaffold): tests/visual/{playwright.visual.config.ts,sections.ts,canvas-baseline.spec.ts,production-surface.spec.ts,README.md}; package.json scripts test:visual + test:visual:update routed via apps/app's @playwright/test; playwright list discovers 34 tests (24 canvas + 10 production); first run writes baselines under __snapshots__/. Production-surface diffs gated behind VISUAL_PROD=1 so the Expo dev server only boots when asked. No Convex cloud calls.
  - Capture baseline screenshots of every section of the design canvas at 1280×900
  - For each implemented production surface (reader, library, paywall, death, co-op, endings, dashboard), capture a matching screenshot at the same viewport with seed data
  - Diff token-bound regions (color, type) with strict tolerance; layout regions with relaxed tolerance
  - Fail CI on color/type drift; surface layout drift as a warning for review
  - Purpose: Catch silent visual drift between the canvas and production before release
  - _Leverage: `apps/app/assets/design/design-system.html`, Playwright config from task 23_
  - _Requirements: 30.10, NFR Performance/Usability_
  - _Prompt: Role: Visual QA automation engineer | Task: Build a Playwright visual regression suite that compares production surfaces against canvas baselines with token-region strictness and layout-region tolerance | Restrictions: Do not lock layout pixel-perfectly across viewports, do not run live provider calls in visual tests, do not commit baseline images that include any user data | Success: CI fails on token drift between production and the design canvas, surfaces layout drift as a reviewable warning, and produces a per-surface diff report_

- [x] 30. Reader layout variants (Book / ModernApp / GraphicNovel / Journal / Mobile)
  - Files: `apps/app/components/reading/ReaderScreen.tsx`, `apps/app/components/reading/layouts/{Book,ModernApp,GraphicNovel,Journal,Mobile}.tsx`, `apps/app/hooks/useReaderSettings.ts`, reader tests
  - 2026-05-11 progress (Reading agent, commit 2942d3b, merged into feat/visual-design-wave-0): Five layouts under components/reading/layouts/, ReaderScreen is now a dispatcher on settings.layout; layout setting wired through useReaderSettings with localStorage persistence. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the four desktop layouts and the phone-optimized mobile layout per canvas § 19 (`reading-layouts`); each layout consumes the same scene+choices state and only varies typography, gutter, chrome, and media affordance
  - Wire the layout setting from `useReaderSettings` to switch at render time; persist per account/guest
  - Purpose: Deliver Requirement 18.3 reading layout variants matching the canvas
  - _Leverage: canvas § 19 (HR.ReadMobile/ReadGraphicNovel/ReadModernApp/ReadJournal), `useReaderSettings`_
  - _Requirements: 18.2, 18.3, 30.10_
  - _Prompt: Role: Reader UI engineer | Task: Lift the four canvas reading layouts into production components that share scene state and switch by setting | Restrictions: Do not fork scene-state per layout, do not block prose streaming on layout chrome, keep all four within token system | Success: a single setting changes layout instantly, all five variants render real scene+choices, and visual regression vs canvas § 19 passes_

- [x] 31. Stats HUD modes and stat-pip motion
  - Files: `apps/app/components/stats/StatsHud.tsx`, `apps/app/components/stats/modes/{Persistent,PeekDrawer,Contextual,FullSheet}.tsx`, `apps/app/components/stats/StatPip.tsx`, HUD tests
  - 2026-05-11 progress (HUD agent, commit 443f792, merged into feat/visual-design-wave-0): StatsHud is a dispatcher over modes/{Persistent,PeekDrawer,Contextual,FullSheet}.tsx; StatPip + pipMotion with reduced-motion fallback; hidden-stat guard in filterVisibleStats/diffVisibleStats; 19 vitest cases. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the four HUD modes per canvas § 20A and the stat-pip spec per § 20B; PeekDrawer is the default; pip fades next to the prose anchor while HUD updates immediately
  - Honor reduced motion (Req 18.5) for pip and HUD transitions; never reveal hidden stats in any mode
  - Purpose: Deliver Requirement 6 HUD modes with the canvas-spec motion
  - _Leverage: canvas § 20 (HS.StatsModes, HS.StatPipSpec), Req 6.2-6.7_
  - _Requirements: 6.1-6.7, 18.4, 18.5_
  - _Prompt: Role: Reader UI engineer | Task: Build the four HUD modes and the stat-pip spec, wired to the same Convex stats state with mode toggled by setting | Restrictions: Hidden stats must remain hidden in every mode, pip motion must respect reduced motion, HUD must not compete visually with prose | Success: every mode renders real stat state, pip animates per spec, reduced motion replaces animation with instant change, and tests cover each mode_

- [x] 32. Death variants — Brutal / Bookish / Cinematic
  - Files: `apps/app/components/death/EndingPanel.tsx`, `apps/app/components/death/variants/{Brutal,Bookish,Cinematic}.tsx`, `convex/llm/prompts/scene.ts` (death-trigger metadata), death tests
  - 2026-05-11 progress (Death/Paywall agent, commit c7eb997, merged into feat/visual-design-wave-0): death/variants/{Brutal,Bookish,Cinematic}.tsx + selectVariant.ts (Cinematic first-find Magus-only); EndingPanel is dispatcher; Cinematic renders via existing VeoCinematic. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the three death variants per canvas § 21A; default is Brutal; Bookish is a tonal alternative; Cinematic fires once per first-find death and only on Pro entitlement
  - Surface variant selection from save metadata + entitlement; never replay Cinematic for a death the reader has already seen
  - Purpose: Deliver Requirement 8 death surfaces matching the canvas
  - _Leverage: canvas § 21A (HS.DeathVariants), Req 8, 17_
  - _Requirements: 8.1-8.5, 17.1-17.4, 24.2_
  - _Prompt: Role: Reader UI engineer | Task: Build the three death variants and the per-save selection logic that respects entitlement and first-find rules | Restrictions: Cinematic is Pro-only and once per ending, Bookish only when tale tone is suitable, no variant may block the "Begin again" CTA | Success: each ending unlocks the correct variant for tier + first-find state, Begin-again remains reachable, and Cinematic uses Veo through MediaPlate not a bespoke player_

- [x] 33. Paywall variants — Soft / Inline / TopBar
  - Files: `apps/app/components/paywall/PaywallPanel.tsx`, `apps/app/components/paywall/variants/{Soft,Inline,TopBar}.tsx`, `apps/app/app/paywall/index.tsx`, paywall tests
  - 2026-05-11 progress (Death/Paywall agent, commit c7eb997, merged into feat/visual-design-wave-0): paywall/variants/{Soft,Inline,TopBar}.tsx + selectVariant.ts (mapped from candle/turns state); PaywallPanel is dispatcher; 21 vitest cases. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the three paywall entry contexts per canvas § 21B: Soft (today's candle fully burned), Inline (next "scene" position so the story breathes around it), TopBar (gentle reminder ribbon with turns remaining)
  - Wire entry-context selection to the candle/turns state; never show two paywall variants simultaneously
  - Purpose: Deliver Requirement 17 paywall surfaces matching the canvas
  - _Leverage: canvas § 21B (HS.PaywallVariants), Req 17_
  - _Requirements: 17.1-17.7, 13.1-13.5_
  - _Prompt: Role: Billing UI engineer | Task: Build the three paywall variants and the selection logic that maps candle state to the correct context | Restrictions: Only one variant may be active per render, all variants must offer the same upgrade actions, copy must not blame the reader | Success: entry context drives variant choice, upgrade flow is identical across variants, and tests cover each entry state_

- [x] 34. Auth surfaces — Sign in, magic link sent, profile archetypes
  - Files: `apps/app/app/login/index.tsx`, `apps/app/components/auth/SignInForm.tsx`, `apps/app/components/auth/MagicLinkSent.tsx`, `apps/app/components/auth/ProfileArchetypes.tsx`, auth tests
  - 2026-05-11 progress (Auth/Safety agent, commit d329d60, merged into feat/visual-design-wave-0): auth/{SignInForm,MagicLinkSent,ProfileArchetypes}.tsx; new login route uses flow phases; profile route at app/profile/index.tsx; archetype tags grafted onto useAccountProfile alongside the existing remote-profile state. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the three auth boards per canvas § 10: sign-in (email + provider buttons), magic-link-sent confirmation, profile "archetypes the narrator learned"
  - Profile surfaces the narrator-inferred archetype tags; user can mute/edit; never display raw prose history
  - Purpose: Match the canvas auth UX without exposing analytics or prose history
  - _Leverage: canvas § 10 (W.SignInBoard, W.MagicLinkBoard, W.ProfileBoard), BetterAuth provider_
  - _Requirements: 3.1-3.4, 15.1-15.4_
  - _Prompt: Role: Auth UI engineer | Task: Build the sign-in form, magic-link-sent surface, and profile archetypes view per canvas § 10 | Restrictions: Do not expose prose history, do not bypass BetterAuth provider, keep profile archetypes editable | Success: each surface renders per canvas, BetterAuth magic-link flow works end-to-end, profile archetypes are editable and persist_

- [x] 35. Patronage tier compare surface
  - Files: `apps/app/app/paywall/index.tsx` (compare view), `apps/app/components/paywall/TierCompare.tsx`, `apps/app/components/paywall/TierCard.tsx`, paywall tests
  - 2026-05-11 progress (Death/Paywall agent, commit c7eb997, merged into feat/visual-design-wave-0): paywall/TierCompare.tsx + TierCard.tsx; lib/billingConfig.ts ships PatronTier metadata + resolvePatronTier; app/paywall/index.tsx composes situational variant + TierCompare. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the four-tier compare board per canvas § 11 with Wanderer / Reader / Patron / Magus; surface limits, media tier, soft caps, and per-cycle price; native builds show the platform-required price + restore flow
  - Purpose: Deliver the patronage upgrade compare needed for Requirement 17.5 and conversion
  - _Leverage: canvas § 11 (W.PricingBoard), Req 17, Stripe + native IAP normalizers_
  - _Requirements: 17.1-17.9, 25.3_
  - _Prompt: Role: Billing UI engineer | Task: Build the four-tier compare board with per-tier crest, included features, soft caps, and price; wire to current entitlement and CTA | Restrictions: Native must use platform IAP not Stripe checkout, copy must not say "free" if usage caps exist, do not advertise a Max tier until it is real | Success: every tier renders with crest + features, current tier is marked, CTA respects platform, and tests cover web + native paths_

- [x] 36. Chapter end consequence reel (between-chapter interstitial)
  - Files: `apps/app/components/reading/ChapterEnd.tsx`, `apps/app/components/reading/ConsequenceReel.tsx`, `convex/turn.ts` (chapter-boundary hook), reader tests
  - 2026-05-11 progress (Reading agent, commit 2942d3b, merged into feat/visual-design-wave-0): reading/ChapterEnd.tsx + ConsequenceReel.tsx; chapter boundary derived client-side from choiceHistory in useTurn (CHAPTER_TURNS=4); echo dropped via deriveEngineEcho — never reveals hidden flags. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the consequence-reel interstitial per canvas § 12: at chapter boundaries, surface the choices the reader made and how they echoed, then resume reading on tap/continue
  - Source the reel content from `turn_history` + ending-flag metadata; never reveal hidden flags
  - Purpose: New chapter-end surface — replays meaningful choices for emotional weight between chapters
  - _Leverage: canvas § 12 (W.ChapterEndBoard), `turn_history`, engine chapter-boundary metadata_
  - _Requirements: 19.1-19.5, 6.1, NFR Usability_
  - _Prompt: Role: Reader UI engineer | Task: Build the consequence reel that fires at chapter boundaries, replays meaningful choices, and returns the reader to the prose stream | Restrictions: Never reveal hidden flags or stats, never block the next chapter behind paywall, must be skippable | Success: chapter boundaries reliably trigger the reel, the reel surfaces only visible-tier consequences, and continuing returns the reader to prose without losing place_

- [x] 37. Discover & share surfaces
  - Files: `apps/app/app/discover/index.tsx`, `apps/app/components/discovery/DiscoverList.tsx`, `apps/app/components/discovery/ShareModal.tsx`, share/discover tests
  - 2026-05-11 progress (Discover/States agent, commit ac1b19a, merged into feat/visual-design-wave-0): app/discover/index.tsx + discovery/{DiscoverList,DiscoverCard,ShareModal}.tsx; ShareEligibility discriminated union (guest_account/private_tale/revoked/mature_blocked/no_link); OG asset via OG_CARD_ASSET_PATH. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the Discover page and Share modal per canvas § 13: archive browser for published tales (tone, length, tier, completion count) and a share modal that respects share-eligibility (Req 22.4)
  - Share modal uses the canonical OG card asset; never embeds personal stats
  - Purpose: Deliver publishing/discovery reader surfaces tied to Requirements 22 and 19.4
  - _Leverage: canvas § 13 (W.DiscoverBoard, W.ShareBoard), `convex/tales/*`_
  - _Requirements: 19.4, 22.1-22.5_
  - _Prompt: Role: Publishing UI engineer | Task: Build the Discover archive list and Share modal per canvas § 13, gated by share-eligibility and using the canonical OG asset | Restrictions: Personal stats may never appear on a shared card, share links must respect tale visibility, do not embed raw prose excerpts that violate safety | Success: Discover lists published tales with filters, Share modal produces a working link + image card, eligibility gates work_

- [x] 38. Narrator voice picker + per-tale continuity
  - Files: `apps/app/components/narrator/VoicePicker.tsx`, `apps/app/components/narrator/NarratorContinuity.tsx`, `apps/app/components/media/NarratorControl.tsx` (added in 816437d), `apps/app/hooks/useNarratorVoice.ts`, `apps/app/hooks/useNarratorLoading.ts` (added in 816437d), `convex/media/narrator.ts`, narrator tests
  - 2026-05-11 progress (Narrator agent, commit 9f309b0, merged into feat/visual-design-wave-0): narrator/{VoicePicker,NarratorContinuity,index}.ts + hooks/useNarratorVoice.ts with per-save key cyoa.narratorVoice.<saveId>.v1 + lastUsed fallback; pickVoice stages pendingChange when status==="pinned" and the picker renders ConfirmDialog; six-voice seed list (Ash/Lark/Beren/Vix/Fen/Mira); preview section added to settings before the Reset divider. pnpm typecheck green offline; no Convex cloud calls.
  - 2026-05-21 follow-up (commit 816437d): Inline playback chrome added via NarratorControl — loading pip mirroring BufferingPip styling, pause/resume button gating the narrator layer's `active` flag, horizontal scrub bar with tap-to-seek (renders only once duration > 0). useNarratorLoading infers "preparing" purely client-side with a 30s grace window (Chirp 3 HD voices typically take 10–15s); resets on sceneId change and terminates the moment the projection's narrator URI arrives.
  - Implement the voice picker per canvas § 14 (waveform sample, default-to-last-used, lock on tap) and the per-tale continuity rules per canvas § 24F (voice id pinned to save, restored on resume, confirm modal to change mid-tale)
  - Voice IDs are TTS-provider-stable; same paragraph plays identically across sessions
  - Purpose: Deliver Requirement 24.4 narration continuity matching the canvas voice flow
  - _Leverage: canvas § 14 (W.NarratorBoard) and § 24F (HCE.NarratorContinuity)_
  - _Requirements: 24.4, 24.5, NFR Usability_
  - _Prompt: Role: Narrator media engineer | Task: Build the voice picker, the per-save voice pin, the resume restore, and the mid-tale change confirm | Restrictions: Voice id is per save not per account, TTS provider voice ids must not drift, mid-tale change requires explicit confirm | Success: picker shows on tale-start, sample auto-plays, voice persists per save across sessions, mid-tale change requires confirm and re-plays current paragraph in new voice_

- [x] 39. Audio architecture — 5-layer mix with narrator ducking
  - Files: `apps/app/components/media/AmbientSoundscape.tsx`, `apps/app/components/media/AudioMix.tsx`, `apps/app/hooks/useAudioMix.ts`, `apps/app/hooks/useNarratorPlayback.ts` (added in 816437d), `convex/media/audio.ts`, audio tests
  - 2026-05-11 progress (Audio agent, commit aa09aa4, merged into feat/visual-design-wave-0): components/media/AudioMix.tsx + hooks/useAudioMix.ts with pure computeMix priority-duck table (narrator base / Veo gated by reducedMotion / music 30% under narrator+veo / ambient 50%/30% / SFX); AmbientSoundscape now a thin wrapper around AudioMix ambient layer with stable public surface; 18+vitest scenarios via apps/app/vitest.config.ts. pnpm typecheck green offline; no Convex cloud calls.
  - 2026-05-21 follow-up (commit 816437d): Narrator HTMLAudio lifted out of AudioMix's hermetic useLayerPlayback into useNarratorPlayback so currentTime/duration flow up to React and a seek handle flows down — required to render the scrub bar in NarratorControl. The four lower layers (Veo / music / ambient / SFX) remain hermetic in useLayerPlayback. AudioMix no longer mounts a narrator player itself; useNarratorPlayback owns the element exclusively to prevent dual-control over the same URI. Volume / paused / muted behavior mirrors useLayerPlayback; native (non-web) is a no-op.
  - Implement the five-layer mix per canvas § 24C: narrator → Veo diegetic audio → generated music → library ambient → SFX; narrator ducks the rest; Veo audio dominates during motion
  - Honor system mute, user mute, and native background rules (Req 24.4)
  - Purpose: Deliver the audio model the canvas specifies for Pro media
  - _Leverage: canvas § 24C (HCE.AudioArch), `AmbientSoundscape`, `VeoCinematic`_
  - _Requirements: 24.3, 24.4, 18.5_
  - _Prompt: Role: Reader audio engineer | Task: Build the 5-layer mix with priority ducking, mute respect, and native background rules | Restrictions: Narrator never gets ducked, ambient must pause on system mute, do not autoplay video audio with reduced motion | Success: all five layers render together with correct ducking, mute and reduced-motion preferences work, native background does not leak audio_

- [x] 40. Mobile shelf + reading view optimization
  - Files: `apps/app/components/reading/layouts/Mobile.tsx` (from task 30), `apps/app/app/library/index.tsx` (mobile shelf variant), mobile tests
  - 2026-05-11 progress (Library agent, commit 66cd9a4, merged into feat/visual-design-wave-0): components/library/{ContinueReading,CoverCard,index}.ts/tsx shipped as new files; wired into app/library/index.tsx is deferred — agent worktree was rooted at initial commit so their library/creator/Mobile rewrites were not viable to merge over the WIP integration. Mobile.tsx tuning is captured for follow-up wiring.. pnpm typecheck green offline; no Convex cloud calls.
  - 2026-05-11 wire-in complete (commit 5876cc8): library/index.tsx now renders <ContinueReading /> for canvas § 8A; reading/layouts/Mobile.tsx still on the wave-1 dispatcher interface (the agent's free-standing rewrite was discarded on merge but its tuning ideas remain to graft in).
  - Tune the mobile shelf and mobile reading view per canvas § 15: phone-first chrome, thumb-reachable choices, single-column shelf with cover-forward cards
  - Purpose: Deliver Requirement 25.1 phone parity with the canvas mobile board
  - _Leverage: canvas § 15 (W.MobileBoard), task 30 Mobile layout_
  - _Requirements: 25.1, 18.3, NFR Usability_
  - _Prompt: Role: Mobile UI engineer | Task: Tune the mobile shelf and reading view to match canvas § 15 with thumb-reachable controls and cover-forward shelf cards | Restrictions: Same React Native tree as web, no native-only hacks, choices must be ≥44pt tap targets | Success: shelf and reading view match canvas at iPhone-13/Pixel-7 widths, choices are tap-friendly, and visual regression matches the canvas mobile board_

- [x] 41. State surfaces — toast / empty / error
  - Files: `apps/app/components/states/Toast.tsx`, `apps/app/components/states/EmptyState.tsx`, `apps/app/components/states/ErrorBoundary.tsx`, `apps/app/hooks/useToast.ts`, state tests
  - 2026-05-11 progress (Discover/States agent, commit ac1b19a, merged into feat/visual-design-wave-0): states/{Toast,ToastHost,EmptyState,ErrorBoundary}.tsx + hooks/useToast.ts; single queue, head-only render avoids overlap; reduced-motion collapses fade animations; ErrorBoundary logs to console, never to user. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement toast/empty/error surfaces per canvas § 16; copy stays in the book voice; error surfaces never expose stack traces or internal ids to the reader
  - Wire a single toast queue with reduced-motion-safe animation
  - Purpose: Deliver the system state surfaces the canvas defines
  - _Leverage: canvas § 16 (W.StatesBoard)_
  - _Requirements: NFR Usability, 18.5_
  - _Prompt: Role: Frontend platform engineer | Task: Build toast, empty, and error surfaces with a single queue and reduced-motion-safe animation | Restrictions: No stack traces in user-facing error copy, no native alerts, all copy in book voice | Success: every error surface renders the canvas state board, toasts queue without overlap, reduced motion replaces animation with instant change_

- [x] 42. Spec-gap surfaces — under-13 block, mature opt-in, locked-choice copy, streaming placeholder
  - Files: `apps/app/components/account/AgeGate.tsx` (under-13 path), `apps/app/components/account/Under13Block.tsx`, `apps/app/components/account/MatureOptIn.tsx`, `apps/app/components/choices/LockedChoiceCopy.tsx`, `apps/app/components/reading/StreamingPlaceholder.tsx`, spec-gap tests
  - 2026-05-11 progress (Auth/Safety agent, commit d329d60, merged into feat/visual-design-wave-0): account/{Under13Block,MatureOptIn}.tsx, hooks/useMatureOptIn.ts (cyoa.matureOptIn.v1) + useUnder13Block (cyoa.under13Block.v1, permanent); choices/LockedChoiceCopy.tsx wired into ChoiceList; reading/StreamingPlaceholder.tsx. pnpm typecheck + tests green offline; no Convex cloud calls.
  - Implement the five spec-gap surfaces per canvas § 18: age gate (A — already covered), under-13 block (B), mature opt-in (C), locked-choice guidance copy (D), streaming placeholder skeleton (E)
  - Under-13 block: permanent block screen, no reset; Mature opt-in: explicit consent, default off, revocable in settings
  - Purpose: Close compliance + safety surface gaps flagged in the reconciliation pass
  - _Leverage: canvas § 18 (HG.AgeGate/Under13/MatureOptIn/LockedChoiceGuidance/StreamingPlaceholder), Req 1, 11, 12_
  - _Requirements: 1.1-1.5, 11.1-11.4, 12.1-12.5, 5.1-5.3_
  - _Prompt: Role: Safety UI engineer | Task: Build the four missing spec-gap surfaces (under-13 block, mature opt-in, locked-choice copy, streaming placeholder) per canvas § 18 | Restrictions: Under-13 block is permanent and cannot be bypassed, mature opt-in defaults to off, locked-choice copy must not reveal hidden flags, streaming placeholder must not block the first paragraph | Success: every spec-gap surface matches the canvas, age/mature gates correctly route, locked-choice copy is consistent, streaming placeholder renders during slow first-paragraph_

- [x] 43. Continue-reading shelf and story-seeding flow refinement
  - Files: `apps/app/app/library/index.tsx`, `apps/app/components/library/ContinueReading.tsx`, `apps/app/components/creator/SeedStoryFlow.tsx`, `apps/app/app/creator/index.tsx`, shelf+seed tests
  - 2026-05-11 progress (Library agent, commit 66cd9a4, merged into feat/visual-design-wave-0): components/creator/{SeedStoryFlow,SeedToneSelector,SeedPremiseInput,index}.ts/tsx shipped as new files; full SeedStoryFlow wiring into app/creator/index.tsx is deferred for the same stale-worktree reason; local classifySeedPremiseLocally mirrors convex/contentPolicy.ts categories.. pnpm typecheck green offline; no Convex cloud calls.
  - 2026-05-11 wire-in complete (commit 5876cc8): creator/index.tsx now renders <SeedStoryFlow /> above the custom-author flow with starters from useLibrary.starterStories and async onLaunchStarter wired to library.createSave; navigates to /read/<saveId> on launch.
  - Refine the home shelf per canvas § 8A (Continue Reading row, last-played beat, candle status) and the seed flow per § 8B (pick where, tone, premise, with starter-tale presets)
  - Purpose: Deliver the enriched-flow surfaces the canvas defines for first-and-returning reads
  - _Leverage: canvas § 8 (V.ContinueReadingBoard, V.SeedStoryBoard), library hooks_
  - _Requirements: 26.1, 26.2, 16.1-16.3_
  - _Prompt: Role: Library + creator UI engineer | Task: Refine the home shelf and seed flow to match canvas § 8A/8B with continue-reading + seeded-story creation paths | Restrictions: Do not surface tales the reader cannot access, do not start a seeded tale if safety classification fails, keep the four starter tales primary on first run | Success: shelf shows continue-reading entries with last-beat preview and candle status, seed flow creates a real Convex save with starter or custom tone/premise_

- [x] 44. Operator dashboard board-level refinement
  - Files: `apps/app/app/admin/index.tsx`, `apps/app/components/admin/AdminDashboardScreen.tsx`, `apps/app/components/admin/boards/{Funnel,Cost,Safety,Live}.tsx`, admin tests
  - 2026-05-11 progress (Operator agent, commit 7a11ee6, merged into feat/visual-design-wave-0): admin/RedactionGuard.tsx with RedactionKind="prose"|"pii"|"safe"; admin/boards/{Funnel,Cost,Safety,Live,internals,index}.tsx wired against existing useAdminAnalytics shape; AdminDashboardScreen refactored to host all four boards under AdminGate; deep-link sub-routes (/admin/funnel|cost|safety|live) preserved; Safety board has explicit allowlists for category/action keys, everything else falls to prose-redaction; Live board structurally wraps detail slots in pii.. pnpm typecheck green offline; no Convex cloud calls.
  - Refine the admin dashboard per canvas § 25 Operator: four boards (Funnel, Cost, Safety, Live load) on the same screen, personal data redacted, no prose ever surfaces
  - Wire each board to its existing Convex query; add the missing redaction guard on Safety and Live boards
  - Purpose: Match Requirement 27 + canvas operator surface
  - _Leverage: canvas § 25 (HCE.OperatorDashboard), existing admin routes (`/admin/{funnel,cost,safety,live}`)_
  - _Requirements: 27.1-27.5_
  - _Prompt: Role: Operator UI engineer | Task: Refine the admin dashboard so funnel/cost/safety/live render as four boards per canvas § 25 with a redaction guard | Restrictions: No raw prose may appear, no PII outside hashed/coarse buckets, operator-only role gating on every board | Success: every board renders against its Convex query, redaction guard blocks prose/PII, operator role gating is enforced at the boundary_

- [x] 45. Per-modality reader settings (illustrations + audio)
  - Files: `apps/app/app/settings/index.tsx`, `apps/app/hooks/useReaderSettings.ts`
  - 2026-05-21 progress (commit 816437d): Settings screen adds two SettingGroups paired with the existing layout/voice controls — "Show illustrations" (gates MediaPlate image and SceneCinematic video together) and "Play narration & ambient audio" (mutes narrator voice and ambient soundscape). useReaderSettings persists `imagesEnabled` and `audioEnabled` per save/account alongside the layout setting, defaulting both on. Settings copy explains the data-saving and quiet-mode tradeoffs.
  - Purpose: Let low-data and quiet-mode readers opt out of either modality without abandoning Pro media
  - _Leverage: existing useReaderSettings + SettingGroup primitive_
  - _Requirements: 18.5, 24.3, NFR Usability_
  - _Prompt: Role: Reader UI engineer | Task: Add per-modality toggles for illustrations and narration+ambient audio to the settings screen and persist them through useReaderSettings | Restrictions: Defaults remain on; toggles must not require app reload; copy must not blame the reader for opting out | Success: toggling either setting immediately hides the corresponding surface, persists across sessions, and never blocks prose streaming_

- [x] 46. Google Cloud TTS routing on dedicated API key
  - Files: `.env.example`, `convex/llm/ttsVoices.ts`, `convex/media/sceneMedia.ts`, `packages/engine/src/llm.ts`, `scripts/dev/convex-local-dev.sh`
  - 2026-05-21 progress (commit 816437d): Cloud TTS lives at texttospeech.googleapis.com which AI Studio Gemini keys cannot call. .env.example documents `GOOGLE_CLOUD_TTS_API_KEY` as a separate credential minted in Google Cloud Console with the "Cloud Text-to-Speech API" enabled; convex-local-dev.sh pushes it into Convex env on dev-up. Narration silently disables (no fallback) when the key is blank — the rest of the pipeline continues uninterrupted.
  - Purpose: Unblock real narrator audio without re-using a credential type that the upstream API rejects
  - _Leverage: existing GEMINI_API_KEY plumbing pattern; convex env push helper_
  - _Requirements: 24.4, NFR Operability_
  - _Prompt: Role: Provider integration engineer | Task: Route Google Cloud TTS through a dedicated API key separate from the Gemini AI Studio key, documented in .env.example and pushed into Convex env by the dev script | Restrictions: Never log the key; never fall back to the Gemini key; narration must degrade silently when the key is absent | Success: narrator clips generate when the key is set, requests do not appear in logs with credential material, absence of the key produces no narrator output and no errors_

- [x] 47. Local Convex dashboard reachable from host (dev infra)
  - Files: `docker-compose.yml`
  - 2026-05-21 progress (commit 816437d): The Convex local backend binds its dashboard SPA (6790) and admin API (6791) to 127.0.0.1 inside the container by design, so Docker port publishing cannot reach them directly. Two alpine/socat sidecars (`convex-dashboard`, `convex-dashboard-api`) share the convex container's network namespace via `network_mode: "service:convex"` and bridge `0.0.0.0:16790/16791` → `127.0.0.1:6790/6791`. The convex service publishes host `6790/6791` → container `16790/16791`. The dashboard SPA at http://localhost:6790 discovers the admin API via `__NEXT_DATA__.defaultListDeploymentsApiUrl = http://127.0.0.1:6791`, which the browser resolves through the same host mapping; CORS is permissive on both API endpoints.
  - Purpose: Let developers inspect tables, run functions, and read logs on the anonymous local deployment without docker exec or remote forwarding
  - _Leverage: existing `convex` service netns + Docker port publishing_
  - _Requirements: NFR Operability (developer experience only — never enabled in the tunnel)_
  - _Prompt: Role: Dev infra engineer | Task: Make the Convex local dashboard reachable from the host browser without exposing it through the public tunnel | Restrictions: Must not add Cloudflare tunnel ingress rules for the dashboard; must respect the dashboard's loopback-bind design rather than forking convex; sidecars must not introduce a new published port beyond the host-facing mappings on convex | Success: http://localhost:6790 loads the dashboard, selecting the anonymous deployment shows tables/functions/logs, and cloudflared has no public hostname pointing at 6790/6791/16790/16791_
