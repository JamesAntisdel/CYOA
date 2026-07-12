# Design — Fireworks Providers, Tier-Aware Routing & Credit Model

Status: BUILD DESIGN (2026-07-12). Implements the fixes from
`docs/reviews/2026-07-12-product-readiness-review.md` (economics + security)
and adds Fireworks AI as the primary inference provider. This doc is the
authoritative reference for the fix-team agents.

Scope of THIS PR: backend cost correctness, LLM provider strategy, credit /
spark metering, and the exploitable-now security findings. Explicitly OUT of
scope (documented as launch-blockers, separate efforts): legal kit, hosting
migration, UGC moderation UI, mobile SDK upgrade / App Store. See the GTM +
mobile sections of the review doc.

House rules unchanged: story-engagement design §0 BC1–BC10 (convex paths carry
their dir; convexHttp casts don't validate; tolerant-drop at LLM boundary;
engine pure; schema/crons/index integrator-reserved; old saves untouched;
projections don't leak spoilers; exactOptionalPropertyTypes → conditional
spread + cleanDoc). `fetch`/`setTimeout` are legal ONLY in Convex actions,
never queries/mutations.

---

## 0. Why (the numbers being fixed)

From the verified economics review:
- Every scene hardcodes `risk:'normal'`; the policy only routes to the cheap
  provider on `risk:'low'` (which nothing sets) → **every production turn goes
  Claude-Sonnet-first at ~2.7¢, a 34× multiplier** over DeepSeek (0.08¢).
- Pro media is **unmetered** (the metering layer is dead code) → an engaged
  Pro reader ≈ **$143/mo COGS vs ~$20 price**.
- Overage price card is **inverted** (video 20¢ priced below a 25¢ still and
  below its own $0.20 COGS).
- Unlimited has **no fair-use cap** (heavy user ≈ $40/mo).
- Hardcoded `deepseek-chat` alias is **deprecated 2026-07-24**; Anthropic
  default `claude-haiku-4-6` **does not exist** (silently upgrades to Sonnet).

Target after fixes: ~48% blended gross margin at 10k MAU (review §economics).

## 1. Provider architecture

### 1.1 Fireworks module (`convex/llm/fireworks.ts`, new)

Fireworks serves many open models behind ONE OpenAI-compatible endpoint
(`https://api.fireworks.ai/inference/v1/chat/completions`). Model the module on
`convex/llm/deepseek.ts` (already OpenAI-compatible) — same `postJson`, same
message shape, same `tokenUsage` extraction — parameterized by model id.

Env (all optional with documented defaults; read via the existing config
pattern):
- `FIREWORKS_API_KEY`
- `FIREWORKS_MODEL_CHEAP` (default `accounts/fireworks/models/deepseek-v3`) — the free/guest workhorse, ~$0.14/$0.28 per M
- `FIREWORKS_MODEL_MID` (default GLM-4.6, ~$0.43/$1.75) — Unlimited default
- `FIREWORKS_MODEL_PREMIUM` (default GLM-5.2, $1.40/$4.40) — Pro / quality retries

Each configured model gets a `{ id, inCostPerMTok, outCostPerMTok,
allowsMature }` entry in the cost table (§1.3). Fireworks is one provider with
three selectable model tiers — NOT three modules.

### 1.2 Tier-aware routing (`convex/llm/providerPolicy.ts`, rewrite `providerOrder`)

Replace risk-as-sole-selector with **entitlement tier** as the primary key;
`risk` becomes a secondary escalation signal only (a parse-failure retry may
bump one tier up). New signature carries `tier: 'guest'|'free'|'unlimited'|'pro'`
and the existing `matureContentEnabled`.

| tier | order (first eligible wins) |
|---|---|
| guest / free | fireworks:cheap → fireworks:mid → deterministic. **Never Anthropic/Vertex** (cost). |
| unlimited | fireworks:mid → fireworks:premium → vertex(gemini) → deterministic. Anthropic only on a parse-retry escalation. |
| pro | fireworks:premium → anthropic:sonnet → vertex → deterministic. (Best prose for the paying media tier.) |

`providerEligible` keeps the mature-content gate: when `matureContentEnabled`,
drop any model whose `allowsMature` is false. Deterministic is always the final
fallback so a turn never hard-fails (BC5).

### 1.2a Operational override — running on Gemini Flash Lite for now

Tier routing deliberately keeps Vertex/Gemini OUT of the guest/free lanes, so
with no Fireworks key those turns fall to the deterministic stub, not Gemini.
Until Fireworks is provisioned we run the whole app on Gemini Flash Lite via an
env escape hatch (`convex/llm/providerPolicy.ts` `overrideOrder`):

```
LLM_PROVIDER_OVERRIDE=vertex          # pin EVERY tier to Gemini, then deterministic
GEMINI_TEXT_MODEL=gemini-2.5-flash-lite   # or gemini-3.1-flash-lite
GEMINI_API_KEY=...                    # (or VERTEX_ACCESS_TOKEN) — vertex must be healthy
```

With the override set, `providerOrder` returns `[vertex, deterministic]` for
all tiers; an unrecognized value is ignored (falls through to tier routing) so
a typo can't strand every turn on the stub. Both Flash-Lite ids are in
`COST_TABLE` so telemetry + the mature gate resolve. To move to Fireworks
later: set `FIREWORKS_API_KEY` (+ optional model ids) and **unset**
`LLM_PROVIDER_OVERRIDE` — tier-aware routing resumes with no code change.

The scene-request assembly sites in `game.ts` (grep `risk:`) must pass the
reader's resolved entitlement tier into the request; the server-core agent
threads `tier` through `SceneGenerationRequest` (conditional-spread) — the
provider agent only consumes it in the policy.

### 1.3 Cost telemetry (`convex/llm/modelCosts.ts`, new)

Single source of truth: `COST_TABLE: Record<modelId, {inPerMTok, outPerMTok}>`
covering every model any provider can select (Fireworks trio, Gemini, Sonnet,
Haiku). Export `costCentsForUsage(modelId, tokenUsage): number`. Providers
already return `tokenUsage`; the turn path multiplies and writes
`estimatedCostCents` into the `analytics_events` turn payload (the operator
dashboard already aggregates that field — it's currently always absent). Update
the table quarterly; note the source date in a comment.

### 1.4 Background-call model fixes (`summarizer.ts`, `storyBible.ts`)

Both bypass the router with hardcoded models. Fixes:
- Replace hardcoded `deepseek-chat` with `FIREWORKS_MODEL_CHEAP` (background
  calls always take the cheapest path).
- Stop reading the shared `ANTHROPIC_MODEL` (which silently upgrades them to
  Sonnet when the scene model is set): add `ANTHROPIC_SUMMARIZER_MODEL` /
  `ANTHROPIC_BIBLE_MODEL` defaulting to a REAL Haiku id (`claude-haiku-4-5`,
  not the nonexistent `-4-6`), used only as the Anthropic fallback leg.
- These calls are cheap and non-blocking; failure stays silent (existing
  discipline).

## 2. Credit / spark model

### 2.1 Unit & prices (`convex/billing/mediaCosts.ts`, new — replaces the inverted `paywall.ts` constants)

1 spark = **$0.01** face value. `MEDIA_SPARK_COSTS` (verified COGS → 48–70%
gross margin):

| media kind | sparks | COGS | margin |
|---|---|---|---|
| scene still (Imagen/Flash-Image) | 15 | $0.045–0.067 | 55–70% |
| narration chunk (TTS) | 8 | $0.042 | 48% |
| illustrated+narrated page (bundle) | 25 | $0.09–0.11 | 56–64% |
| Veo 4s clip | 60 | $0.20 | 67% |
| Omni endpoint cinematic | 240 | $0.80 | 67% |

Delete `calculateOverageCents`'s inverted `image*25 + video*20` math; nothing
in product code calls it (verified) so no migration.

### 2.2 Ledger (`media_credits_ledger` table — integrator-owned schema add)

```ts
media_credits_ledger: defineTable({
  accountId: v.id("accounts"),
  delta: v.number(),                 // + grant/purchase/refund, - spend
  reason: v.union(v.literal("pro_allowance"), v.literal("pack_purchase"),
                  v.literal("reader_spend"), v.literal("creator_spend"),
                  v.literal("refund")),
  idempotencyKey: v.string(),        // unique index — dedupe grants/spends/webhooks
  assetId: v.optional(v.id("assets")),
  stripeSessionId: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_account", ["accountId"]).index("by_idem", ["idempotencyKey"])
```

Balance = indexed sum over `by_account`, mirrored into the existing-but-unused
`entitlement.creditBalanceCents` for cheap reads. Reuse the
`stripe_webhook_events` idempotency-dedupe pattern.

### 2.3 Spend / refund flow

`assertAndReserveSpark(ctx, account, costSparks, idempotencyKey)` runs INSIDE
the media queue mutation, before scheduling the job: check balance, write a
`reader_spend`/`creator_spend` debit row, decrement the mirror. On job failure
(media assets already have `failed` states) the mark-failed internal mutation
writes a `refund` row keyed `refund:<assetId>`. Idempotent on both legs.

Wire `applyUsageDelta`/the new spend check into the queue mutations the map
identifies (`queueSceneImage`, `queueSceneVideo`, `queueSceneNarration`,
`queueEndpointCinematic`, anchor/NPC portrait). These live in
`convex/media/**` + `convex/assets.ts` — NOT game.ts — so the billing agent
owns them.

### 2.4 Allowances, caps, packs

- **Pro** ($19.99/mo): monthly grant of **1,200 sparks** (`pro_allowance`
  ledger row materialized on billing-period rollover, idempotency
  `pro_grant:<accountId>:<periodStart>`). "~3 fully-illustrated stories/month."
- **Packs** via one-time Stripe checkout (`createCreditPackCheckout`,
  `mode:'payment'` — the existing `createCheckoutSession` is subscription-only):
  500/$4.99, 1,200/$9.99, 4,000/$24.99. Webhook `checkout.session.completed`
  branch → `pack_purchase` row keyed by session id. The dormant `credits`
  `PaywallReason` becomes real.
- **Unlimited fair-use cap**: soft ceiling **60 turns/day**; past it, degrade
  in-fiction to `FIREWORKS_MODEL_CHEAP` ("the ink runs thin tonight…") rather
  than block — bounds worst-case COGS near price. Free stays 10 turns/day,
  fully beatable, text+still complete.
- **Pro media default**: flip prod default from `per_scene_legacy` to
  `endpoint_cinematic` (opening + ending + ≤2 chapter stingers, already capped)
  so Pro video COGS is ≤$3.20/run, not $0.20 × every scene.

### 2.5 Cosmetic-only guardrail (`packages/engine` or `convex/lib`, + lint)

`assertSpendIsCosmetic` invariant: (1) the `game.ts` turn loop / choice gating
may NEVER import the credits ledger — enforce with a lint rule alongside the
dead-key linter; (2) reader-directed spend only ATTACHES media to an
already-resolved `sceneId`, never influences prose/choice generation; (3) the
free text+still path always resolves regardless of balance. Product principle
7 ("pay for joy, not entry") made structural, not promised.

Note: the reader-facing "Illuminate this page" affordance and creator-funded
beats (review §cinematic-controls) are the CONSUMER surfaces of this ledger —
this PR builds the economy + enforcement; the reader UI is a fast follow.

## 3. Security / abuse fixes (from the code review)

| id | fix | files |
|---|---|---|
| H1/H2 | Rate-limit `createSave`, `createGuestAccount`, and the bible-generation schedule (per-account + per-source-key); gate turn-0 bible+scene behind the budget primitive. Extend `ratelimit.ts` beyond the daily counter. | `ratelimit.ts`, `game.ts` |
| M1 | Route `seedTitle`, `seedTone`, and publish-time `tone` through `evaluateTextPolicy` at the sites `seedPremise` already uses. | `game.ts` createSave, `creatorFunctions.ts`/`liveCore.ts` publish |
| M2 | Add `story_bibles`, `daily_results`, `leaderboard_entries` to `deleteAccount` AND `purgeExpiredGuests` cascades, and `story_bibles` to `buildAccountExportBundle`. Hoist both cascades to one shared helper. | `accountFunctions.ts`, `lifecycle.ts` |
| M3 | `loadStory` tolerates archived-but-referenced seeds for EXISTING saves (snapshot the seed graph onto the save at launch, or mirror `talesFunctions:loadTaleStory`'s "the grant persists" posture) so creator deletion doesn't brick live reader runs. | `game.ts` loadStory, `liveCore.ts` |
| L1 | Add the `activeTurnRequestId` in-progress guard to the non-streaming `submitChoice` path for parity. | `game.ts` |
| L2 | Require a claimed (`kind:"user"`) account to publish/remix to the public shelf; drafts may stay guest-open. | `creatorFunctions.ts` |
| ops | Verify `CYOA_DEV_FORCE_PRO_MEDIA` unset on the tunnel deploy (not code — flagged for the integrator's smoke). | deploy env |

## 4. Ownership & sequencing (avoid the game.ts collision)

`game.ts` and `schema.ts` are the collision points, so exactly ONE agent edits
each. Two phases:

**Phase 1 — parallel, no game.ts/schema.ts edits:**
- **Agent PROVIDERS** owns `convex/llm/**`. Builds fireworks.ts, tier-aware
  `providerPolicy`, `modelCosts.ts` (exports `costCentsForUsage`,
  `orderProvidersForTier`), fixes summarizer/storyBible/anthropic model config.
  Does NOT touch game.ts.
- **Agent BILLING** owns `convex/billing/**`, `convex/assets.ts`,
  `convex/media/**` queue internals. Builds `mediaCosts.ts`, the spend/refund
  helpers (`assertAndReserveSpark`, refund-on-failed), wires them into the
  media queue mutations, fixes the price card, adds the Unlimited-cap helper +
  Pro `endpoint_cinematic` default flip, `createCreditPackCheckout` + webhook
  branch, cosmetic-only lint. Reports the `media_credits_ledger` shape to the
  integrator. Does NOT touch game.ts/schema.ts.

**Phase 2 — single agent owns game.ts + schema.ts + reserved files:**
- **Agent SERVER-CORE / integrator**: all §3 game.ts security edits + purge
  cascades; lands the `media_credits_ledger` table + any reserved-file adds;
  WIRES the Phase-1 helpers into the turn path (thread `tier` into the LLM
  request, write `estimatedCostCents` telemetry, call the media-spend gate,
  apply the Unlimited soft cap). Then codegen + full typecheck + full suites +
  fix cross-agent fallout.

**Phase 3 — verifier**: typecheck/suites/live smoke (cheap-tier routing
actually selects Fireworks; a Pro media spend debits + a forced job-failure
refunds; a guest create-save loop is rate-limited; policy-gated title blocks).

All helper contracts (signatures in §1–§2) are fixed HERE so Phase-2 can wire
against them even where Phase-1 is still in flight.
