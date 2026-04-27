# Project Structure

## Directory Organization

The repo is a **pnpm workspace monorepo**. Three runtime targets (engine library, Convex backend, unified Expo client) plus shared utilities, story data, infrastructure-as-code, and the design bundle.

```
CYOA/
├── apps/
│   └── app/                    # Expo Router app — web + iOS + Android
│       ├── app/                # Expo Router file-based routes
│       │   ├── _layout.tsx     # Root layout (theme, auth, ConvexProvider)
│       │   ├── index.tsx       # Landing / cover (route: /)
│       │   ├── library/        # Starter adventures + "weave a tale"
│       │   ├── read/[saveId]/  # The reading view (the core surface)
│       │   ├── map/[saveId]/   # Endings web for a save
│       │   ├── endings/        # Trophy crypt (per-account)
│       │   ├── settings/       # Reader's preferences
│       │   ├── coop/           # Pass-the-controller + remote-room sessions
│       │   ├── tale/[taleId]/  # Public read-along view of a published tale + fork-from-here
│       │   ├── publish/[saveId] # Author-facing publish flow (title, cover, privacy, fork policy)
│       │   ├── creator/        # Creator authoring: seed an adventure, view earnings
│       │   ├── seasons/        # Time-limited tales + leaderboards
│       │   ├── account/        # Sign-in (BetterAuth + SSO), profile, subscription mgmt
│       │   ├── paywall/        # Stripe-first checkout; StoreKit / Play Billing where required
│       │   └── admin/          # In-house operator dashboard (admin-gated)
│       │       ├── funnel/     # Activation → tutorial → signup → paid → Pro
│       │       ├── cost/       # Per-provider LLM/image/video spend
│       │       └── live/       # DAU, concurrent reads, ending unlocks
│       ├── components/         # Cross-route UI components
│       │   ├── reading/        # ReadView (book/app/graphic-novel/journal)
│       │   ├── stats/          # HUD modes (persistent/peek/contextual/sheet)
│       │   ├── choices/        # ChoiceList, locked-choice rendering
│       │   ├── death/          # Death screen variants
│       │   ├── coop/           # Turn indicator, vote tray
│       │   ├── paywall/        # Daily-limit modal, ambient counter
│       │   ├── media/          # IllustrationFader, VeoCinematic player
│       │   ├── admin/          # Charts, tables for the operator dashboard
│       │   └── primitives/     # Buttons, dividers, inputs (no engine deps)
│       ├── hooks/              # useSave, useTurn, useStreamingScene, useTheme
│       ├── lib/                # Client-side utilities (Convex client, storage, auth glue)
│       ├── theme/              # Day/Night/Sepia tokens, typography stacks
│       └── app.json            # Expo config
│
├── convex/                     # Convex backend (functions, schema, http actions)
│   ├── _generated/             # Convex codegen (do not edit)
│   ├── schema.ts               # Tables: accounts, entitlements, saves, turn_history,
│   │                           #          endings_unlocked, story_tags_index,
│   │                           #          published_tales, tale_reads, tale_forks,
│   │                           #          authored_seeds, seasons, leaderboard_entries,
│   │                           #          coop_rooms, analytics_events,
│   │                           #          daily_turn_counter, assets
│   ├── auth.config.ts          # BetterAuth ↔ Convex integration
│   ├── http.ts                 # HTTP actions: SSE turn stream, Stripe webhook, BetterAuth callbacks
│   ├── turn.ts                 # The read loop — actions + mutations
│   ├── saves.ts                # Save CRUD, rewind (Story mode), purge (Hardcore on death)
│   ├── library.ts              # Starter-adventure listing, weave-a-tale entry
│   ├── endings.ts              # Endings map data + trophy crypt queries
│   ├── account.ts              # Profile, export, delete
│   ├── billing/                # Subscription billing — Stripe primary, native IAP normalized
│   │   ├── nativeReceipts.ts   # StoreKit / Play Billing receipt verification → entitlements
│   │   ├── apple.ts            # StoreKit receipt verification helpers
│   │   ├── google.ts           # Play Billing receipt verification helpers
│   │   ├── stripe.ts           # Web checkout + Stripe Connect (creator payouts)
│   │   ├── entitlements.ts     # Single source of truth: read by paywall checks across surfaces
│   │   └── paywall.ts          # Daily-turn-counter check + paywall trigger logic
│   ├── tales.ts                # Publish a run → immutable tale; read-along queries; fork-from-node
│   ├── creator.ts              # Authored seed adventures, play-time accounting, payout queue
│   ├── seasons.ts              # Time-limited tale registration, leaderboard queries
│   ├── coop.ts                 # Co-op rooms (pass-the-controller + remote, day one)
│   ├── analytics.ts            # Event ingest, funnel/cohort aggregates (in-house)
│   ├── ratelimit.ts            # Daily-turn-counter (per account, scheduled reset)
│   ├── memory.ts               # Memory-window builder (vector search over scene summaries)
│   ├── llm/                    # LLM orchestration
│   │   ├── anthropic.ts        # Claude client wrapper, streaming, retry
│   │   ├── vertex.ts           # Vertex AI client (Gemini text + Imagen image + Veo video)
│   │   ├── router.ts           # Primary/fallback selection, provider health
│   │   ├── prompts/            # Prompt templates per turn type
│   │   └── parse.ts            # Zod-validated parsing of LLM output → engine choice
│   ├── media/                  # Image / video generation orchestration
│   │   ├── imagen.ts           # Schedule + persist Gemini/Imagen results
│   │   └── veo.ts              # Schedule + persist Veo results, mirror to GCS
│   └── crons.ts                # Scheduled functions (daily resets, guest TTL, asset backfill)
│
├── packages/
│   ├── engine/                 # The Game Spec engine — pure TS, no I/O, no Convex
│   │   ├── src/
│   │   │   ├── types.ts        # Story, Node, Choice, Effect, Attribute, Inventory, Flag, Mode
│   │   │   ├── state.ts        # PlayerState shape + initial-state helpers
│   │   │   ├── apply.ts        # applyChoice, enterNode (Auto-Modifiers)
│   │   │   ├── visibility.ts   # evaluateConditions: visible | locked | hidden
│   │   │   ├── delayed.ts      # Delayed Consequences scheduler
│   │   │   ├── death.ts        # Vitality≤0 → Death scene jump
│   │   │   ├── flags.ts        # Story tag set/get/has
│   │   │   ├── inventory.ts    # add/remove/has item, item-as-key checks
│   │   │   ├── stats.ts        # Hidden + visible attribute deltas
│   │   │   ├── modes.ts        # Story/Hardcore rules
│   │   │   ├── endings.ts      # Ending registration + unlock tracking
│   │   │   └── index.ts        # Public API barrel
│   │   └── tests/              # Vitest — high coverage by mandate
│   │
│   ├── stories/                # Curated starter adventures (data, not code)
│   │   ├── training-room/      # Tutorial: 3 rooms, escape
│   │   ├── bone-cathedral/     # Gothic, long
│   │   ├── iron-court/         # Intrigue, medium
│   │   ├── ashfall/            # Survival, hard
│   │   └── index.ts            # Story registry
│   │
│   └── shared/                 # Cross-cutting types/utilities
│       ├── api/                # Zod schemas for Convex args/return types consumed by client
│       ├── analytics/          # In-house event names + payload types
│       ├── auth/               # BetterAuth provider config (Google, Apple, GitHub, Microsoft, Discord)
│       └── env/                # Env-var schema (Zod)
│
├── infra/                      # Pulumi (TypeScript) → GCP
│   ├── index.ts                # Stack entry point
│   ├── project.ts              # GCP project + API enablement (Vertex AI, Storage, CDN, DNS, Secret Manager, IAM)
│   ├── iam.ts                  # Service accounts: Convex→Vertex, CI deploy
│   ├── hosting.ts              # Cloud Storage buckets (cyoa-web, cyoa-assets) + Cloud CDN
│   ├── dns.ts                  # Cloud DNS records
│   ├── secrets.ts              # Secret Manager entries (Anthropic, Vertex SA JSON, Stripe, BetterAuth)
│   ├── monitoring.ts           # Uptime checks, alert policies
│   ├── stacks/                 # Pulumi stack configs: dev / staging / prod
│   └── README.md               # How to bootstrap a new environment
│
├── design-bundle/              # The Claude Design handoff (reference only)
│   ├── README.md
│   ├── chats/
│   └── project/                # The HTML wireframes + JSX surfaces + Game Spec
│
├── .spec-workflow/             # Steering docs, specs, templates
│   ├── steering/
│   │   ├── product.md
│   │   ├── tech.md
│   │   └── structure.md        # ← this file
│   ├── specs/                  # Feature specs (requirements, design, tasks)
│   ├── templates/
│   ├── user-templates/
│   └── approvals/
│
├── .github/workflows/          # CI: lint, test, Pulumi up, Convex deploy, EAS update
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

### Why this shape

- **`packages/engine/` is sacred and standalone.** Implements the Game Spec and nothing else. No React, no Convex, no LLM, no I/O, no environment access. Anything else can be rewritten or replaced; the engine cannot, because it is the rules of the game. Its tests are the spec made executable.
- **`apps/app/` is one Expo Router project.** Same code path for web and native. The operator dashboard lives here as `app/admin/*` routes, gated by an `isAdmin` claim from BetterAuth — one auth, one component library, no separate admin app.
- **`convex/` is at the repo root**, not inside `apps/`. Convex's CLI expects this; we keep its convention. It contains all server-authoritative logic: the read loop, LLM orchestration (Anthropic + Vertex AI + DeepSeek), media generation (Imagen + Veo), billing webhooks, BetterAuth callbacks, daily-turn-counter, in-house analytics ingestion.
- **`packages/stories/` is data.** Starter adventures are TS modules consumed by the engine. Never import React, never call APIs. This is the seam where (post-MVP) a designer authoring tool lands: it produces the same shape, just outside the repo.
- **`packages/shared/` carries only what crosses the wire.** Convex arg/return Zod schemas, in-house analytics event names, BetterAuth provider config, env schemas. If a type lives only in one process, it lives in that process.
- **`infra/` is Pulumi, TypeScript, GCP-targeted.** Provisions everything around Convex (which is fully managed and deployed via its own CLI). Env vars stored in GCP Secret Manager are pushed to Convex via the deploy pipeline.

## Naming Conventions

### Files

- **React components**: `PascalCase.tsx` (`ReadView.tsx`, `ChoiceList.tsx`, `DeathBrutal.tsx`, `VeoCinematic.tsx`).
- **Hooks**: `useThing.ts` (`useStreamingScene.ts`, `useConvexAuth.ts`).
- **Engine modules**: `lowercase-noun.ts` (`apply.ts`, `visibility.ts`, `inventory.ts`).
- **Convex functions**: `lowercase-noun.ts` per concept (`turn.ts`, `saves.ts`, `analytics.ts`); folders for grouped concepts (`llm/`, `media/`).
- **Story data**: `kebab-case/` directory with `index.ts` + per-node `*.ts` files (`training-room/room-1.ts`).
- **Pulumi modules**: `lowercase-noun.ts` (`hosting.ts`, `iam.ts`).
- **Tests**: colocated next to source as `*.test.ts` / `*.test.tsx`. Engine tests live in `packages/engine/tests/` because they're spec-mirror tests.

### Code

- **Types/Interfaces**: `PascalCase` (`PlayerState`, `Choice`, `EffectList`).
- **Functions / hooks / variables**: `camelCase` (`applyChoice`, `useSave`, `currentNode`).
- **Engine constants**: `SCREAMING_SNAKE_CASE` (`MAX_INVENTORY_SLOTS`, `DEFAULT_VITALITY`).
- **Story tags / flags**: `snake_case` strings (`met_queen`, `betrayed_thieves`) — they're identifiers in story content, not code, so they read like the Game Spec uses them.
- **Convex function names**: `camelCase` exports matching the file (`export const submit = action(…)` in `turn.ts` → called as `api.turn.submit`).
- **Analytics event names**: `dot.case` (`turn.requested`, `ending.unlocked`, `paywall.shown`).

## Import Patterns

### Import Order

1. Node built-ins (Convex / Pulumi only).
2. External dependencies (`react`, `expo-router`, `convex/server`, `convex/react`, `@anthropic-ai/sdk`, `@google/generative-ai`, `zod`, `@pulumi/gcp`, …).
3. Internal workspace packages (`@cyoa/engine`, `@cyoa/shared`, `@cyoa/stories`).
4. Relative imports within the same app/package.
5. Style imports (rare — we use inline styles via theme tokens, not CSS files; React Native doesn't speak CSS files).

### Module/Package Organization

- **Workspace packages publish via `package.json#exports`** with subpath exports for tree-shaking (`@cyoa/engine`, `@cyoa/engine/types`).
- **No deep imports across workspace boundaries.** Apps and Convex import only from a package's public barrel (`@cyoa/engine`), never `@cyoa/engine/src/internal/foo`.
- **The engine never imports from `apps/`, `convex/`, or `infra/`.** The dependency graph is one-way: `apps/* | convex/* | infra/* → packages/* → (nothing)`.
- **`convex/` may import from `packages/engine`, `packages/shared`, `packages/stories`** — that's how the Game Spec runs server-side.
- **`apps/app/` may import engine *types* only** (for rendering decisions like "is this choice locked?"). It never executes engine logic; it asks Convex.

## Code Structure Patterns

### Module/Class Organization

Standard order within a TypeScript module:

1. Imports (in the order above).
2. Type declarations (`type`/`interface`).
3. Constants.
4. Exported public functions / Convex `query` / `mutation` / `action` definitions.
5. Internal helper functions (not exported).

### Function/Method Organization

- **Validate at boundaries, not internals.** Zod parses at every Convex function entry, at LLM-output entry, at Stripe webhook entry. Downstream functions trust their typed inputs.
- **Engine functions are pure.** Inputs in, new state out. No `console.log`, no `fetch`, no clock reads (clock is passed in if needed, e.g. for delayed-consequence scheduling).
- **Convex queries are read-only and reactive.** Mutations are transactional and short. Anything that calls an external API (Anthropic, Vertex AI, Stripe) is an `action`.
- **Streaming first.** LLM prose streams via Convex HTTP actions over SSE. Reactive queries push state deltas. The player should see motion as soon as possible.
- **Provider router pattern.** `convex/llm/router.ts` selects Anthropic vs Vertex AI vs DeepSeek per turn based on health, capability, risk, safety eligibility, and cost; the rest of the codebase calls one interface.

### File Organization Principles

- **One React component per file**, named to match the file.
- **One engine concept per file** (visibility logic in `visibility.ts`, inventory in `inventory.ts`).
- **One Convex feature per file** at the top level (`turn.ts`, `saves.ts`); subfolders for related groups (`llm/`, `media/`).
- **Co-locate tests** for client and Convex; **separate tests folder** for the engine.
- **Story data files are short and declarative.** A node should fit on one screen.

## Code Organization Principles

1. **Engine purity is non-negotiable.** Any PR introducing I/O, `fetch`, `Date.now()`, React, or Convex inside `packages/engine/` is wrong. The engine is the rules.
2. **Convex is authoritative.** Any state change a player can perceive is decided server-side in a Convex mutation/action, evaluated by the engine. The client renders, animates, and asks; it does not decide.
3. **One codebase, two surfaces.** If a feature can't be expressed in components that work on both Expo web and native, the design needs to change before the feature does.
4. **Story data is data, not code.** Curated adventures live in `packages/stories/` as TS modules with no logic — easy to lift into a future authoring tool.
5. **Public API surfaces are small.** Each package exports a barrel. Anything not in the barrel is internal and may move without notice.
6. **No third-party trackers.** Analytics events go through Convex `analytics_events` only. No script tags pointing at vendor CDNs in the client bundle.

## Module Boundaries

- **Engine ↔ Stories**: stories conform to types from `@cyoa/engine`; the engine never references stories.
- **Engine ↔ Convex**: Convex *calls* engine functions; it does not reach into engine internals or persist engine state in non-engine shapes. Convex stores engine state as opaque JSON (validated by the engine on read/write).
- **Convex ↔ Client**: typed via `@cyoa/shared/api` Zod schemas + Convex's generated `api` types. The client never imports from `convex/_generated` paths directly outside the Convex codegen client; it uses the typed `api` surface.
- **Client ↔ Engine**: client imports engine **types only**. It never executes engine logic — when in doubt, call a Convex query.
- **Stories ↔ LLM**: stories declare LLM prompt seeds and tone hints; `convex/llm/` reads them as configuration, never the other way around.
- **Infra ↔ runtime**: Pulumi provisions buckets, IAM, secrets; the runtime reads secrets via env. No code in `apps/` or `convex/` imports from `infra/`.

## Code Size Guidelines

- **File size**: aim for ≤300 lines; split when exceeded.
- **Function size**: ≤50 lines; split if you need scrolling.
- **Engine modules**: each one concept; if a file mixes inventory and stats, split it.
- **Convex modules**: one feature per file; split `llm/` and `media/` into subfolders when they grow.
- **React components**: one per file; if a component grows past ~150 lines, extract subcomponents into the same folder.
- **Nesting depth**: ≤4 levels in functions, ≤3 in JSX before extracting a subcomponent.

## Dashboard/Monitoring Structure

- **Player dashboards** (Endings Map, Trophy Crypt) are routes inside `apps/app/app/`. Same component tree, same Convex reactive queries.
- **Operator dashboard** (in-house, no third-party trackers) lives at `apps/app/app/admin/`, gated by an `isAdmin` claim from BetterAuth. Reads Convex `analytics_events` aggregations exposed via Convex queries; charts render in `components/admin/`.
- **GCP-side observability**: Pulumi provisions Cloud Monitoring uptime checks and alert policies for the static web bucket and the Vertex AI service-account error rate. Convex's own observability (function logs, latency) lives in the Convex dashboard.

## Documentation Standards

- **Engine package**: TSDoc on every exported symbol. The engine's public API is the executable Game Spec; readers should be able to navigate it without opening a `.md` file.
- **Convex functions**: each file has a top comment naming the contract (function type — query/mutation/action/HTTP — auth requirement, args shape via Zod, return shape). Client callers get types via `api`.
- **Stories**: each starter adventure has a `README.md` summarizing premise, tone, expected length, target audience, and which Game Spec features it exercises (used for tutorial mapping).
- **Pulumi**: `infra/README.md` documents how to bootstrap a new GCP project, what manual steps remain (e.g. Vertex AI quota requests, Apple/Google OAuth client setup), and how secrets flow from Secret Manager into Convex.
- **Inline comments**: only when the *why* is non-obvious (a workaround, an invariant, a subtle constraint). Don't restate the *what*.
- **No top-level README explosion**: one `README.md` at repo root for orientation; one per package; one for `infra/`; nothing else.
