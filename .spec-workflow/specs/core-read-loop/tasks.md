# Tasks Document - Core Read Loop / Full V1 App

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
