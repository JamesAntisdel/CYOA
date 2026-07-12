# Product-Readiness Review — Full Findings (2026-07-12)

Four-specialist review requested by the founder: backend security/correctness
code review, unit-economics / credit-model profitability, productization (GTM),
and mobile app + store compliance. Run against merged main (post PR #3/#4).
Companion to `2026-07-11-panel-review-2.md` — findings known from that panel
were quantified here rather than re-reported.

---

## Unit Economics — Marcus

**Summary:** I built the cost model from the code and verified every price against current vendor rate cards. Text turns cost 0.08¢–3.1¢ depending on provider, but a hardcoded risk flag routes every production turn to the most expensive provider (Claude Sonnet 4.6, ~2.7¢/turn), making a maxed free user cost ~$8.10/mo — roughly the price of the subscription meant to fund them. Pro is the real fire: media is completely unmetered (the metering layer is dead code), and an engaged Pro reader generates ~$140+/mo in media COGS (20¢ Veo clip + ~5¢ still + ~4¢ TTS per scene, or $3.20/run in Omni cinematics) against a plausible $19.99 price — a −600% margin. Unlimited has no fair-use cap, the overage table prices video below stills and below its own COGS, and the live tunnel deploy's dev flag hands full Pro media to unlimited free-to-mint guest identities. The current structure is not profitable at 1k or 10k MAU under any plausible conversion; it becomes solidly profitable with four changes: tier-aware provider routing, a wired-up spark ledger with the schedule I propose below, enforced Pro allowances, and an Unlimited fair-use cap.

### Findings

#### [HIGH] Cost model per text turn: 0.08¢ (DeepSeek) to 3.1¢ (Sonnet worst-case); 15-turn session $0.015–$0.47

Scene call: measured mid-story prompt is ~15.4k chars ≈ 3.8k tokens input (baseline 10.1k chars ≈ 2.5k tok; +1400 tok pursuit +600 tok bible budgets ⇒ worst ~5.8k tok). Output: Anthropic capped at max_tokens 900; Vertex observed 600–1500. Per-turn scene cost: DeepSeek v4-flash ($0.14/$0.28 per M) ≈ $0.0008; Gemini 3 Flash ($0.50/$3.00) ≈ $0.005; Claude Sonnet 4.6 ($3/$15) ≈ $0.0115 in + $0.0135 out = $0.025 (worst $0.031). Summarizer runs every turn (≤900 out, ~600-tok prompt): $0.0002–$0.003. Bible is 1600 tok out once per save + per-act refresh ≈ $0.0006/turn amortized. Typical 15-turn session: $0.015 (DeepSeek), ~$0.10 (Gemini), ~$0.41 (Sonnet path).

*Evidence:* convex/llm/anthropic.ts:34,65 (max_tokens 900, claude-sonnet-4-6); vertex.ts:68,178 (8192 cap, gemini-3-flash-preview, observed 600–1500); summarizer.ts:58; storyBible.ts:71; measured buildScenePrompt: 10,086 / 15,353 chars (tsx run); tests/promptScene.test.ts:558-591,734-755; pricing: Anthropic $3/$15 (claude-api skill, cached 2026-06-24), DeepSeek api-docs.deepseek.com $0.14/$0.28, Gemini ai.google.dev $0.50/$3.00

#### [CRITICAL] Every scene request hardcodes risk:'normal', so the 'cost' provider is unreachable — all production turns route to Claude Sonnet first (34x cost)

providerOrder() only uses DeepSeek for risk==='low', but game.ts sets risk:'normal' on every scene request (grep shows no 'low' assignment anywhere). providerEligible additionally requires matureContentEnabled===false for DeepSeek. Net effect: with ANTHROPIC_API_KEY configured, the candidate order is always [anthropic, vertex, deterministic] and every turn costs ~2.7¢ instead of 0.08¢ (DeepSeek) or 0.5¢ (Gemini). The router's cost tier is dead weight; the operator's only lever today is unsetting the Anthropic key entirely.

*Evidence:* convex/llm/providerPolicy.ts:44-48 (order by risk); :9-11 (deepseek eligibility); convex/game.ts:1686,1720,1977,2188,4283 (risk:'normal' at every call site, no 'low' exists); cost delta: $0.025 vs $0.00074/turn ≈ 34x

#### [CRITICAL] Pro media is fully unmetered: allowances (100 images / 20 videos) exist only as data; the metering layer is dead code — engaged Pro ≈ $143/mo COGS vs ~$20 price

QUANTIFIED (existence known from panel review): assertProMediaAllowed checks only tier+status+content policy — never includedImages/includedVideos. applyUsageDelta/calculateOverageCents are called from nowhere in product code; usage_meters rows are only ever deleted (lifecycle/account cascades), never written. Under per_scene_legacy a Pro reader gets, per scene: 1 still (gemini-3.1-flash-image, $0.045–0.067), 1 narration (~1.4k chars Chirp 3 HD @ $30/M chars ≈ $0.042), and 1 Veo 3.1 Lite 720p 4s clip ($0.05/s × 4 = $0.20) — queued per scene after the image, not gated on cinematic tags. 15 turns/day × 30 days = 450 scenes: stills $22, TTS $19, Veo $90, text ~$12 ⇒ ~$143/mo. Endpoint-cinematic strategy is no cheaper: opening+ending+2 chapter Omni cinematics = 4 × $0.80 = $3.20/run. If the 100-img/20-video allowance were enforced, media COGS drops to ~$8.50 + unmetered TTS.

*Evidence:* convex/assets.ts:93-110 (no quota check); convex/billing/paywall.ts:25-58 (applyUsageDelta defined, zero call sites — grep hits only lifecycle.ts:127, accountFunctions.ts:181,310 deletions); sceneMedia.ts:371-395 (post-Imagen queueSceneVideo per scene); veo.ts:51-61 (5¢/s, 4s default — matches verified $0.05/s Veo 3.1 Lite 720p, ai.google.dev); cinematics.ts:61-65 (8s × 10¢/s = $0.80, matches verified ~$0.10/s Omni Flash); TTS $30/1M chars cloud.google.com/text-to-speech/pricing

#### [HIGH] Overage table prices video BELOW stills and at/below COGS: image 25¢ (73–82% margin), video 20¢ (0% to −75% margin), tokens 1¢/1k (≈0% on Sonnet)

QUANTIFIED (existence known): calculateOverageCents charges imageOver×25¢ + videoOver×20¢ + 1¢ per 1k premium tokens. Verified COGS: still $0.045–0.067 ⇒ 73–82% margin (fine). Video: 4s Veo Lite 720p costs exactly $0.20 ⇒ 0% margin; the config coerces 1080p to 8s ($0.64) ⇒ −69%; an Omni endpoint cinematic costs $0.80 ⇒ −75% if ever billed as a 'video'. Token overage: Sonnet blended (3.8k in @ $3/M + 0.9k out @ $15/M ≈ $0.025 per ~4.7k tokens ≈ 0.53¢/1k input-side, but output alone is 1.5¢/1k) — the 1¢/1k rate is below Sonnet output cost. The one unit with healthy margin (images) is the cheapest to serve; the expensive units are priced at or below cost. All of it moot today since nothing calls it — but these constants must not survive into the credit model.

*Evidence:* convex/billing/paywall.ts:57 (Math.ceil(premiumOver/1000) + imageOver*25 + videoOver*20); veo.ts:139-141,193-198 (durationMs/1000 × 5¢; 1080p forces 8s); cinematics.ts:61-65; math: 20¢ price vs 20–80¢ cost

#### [HIGH] Unlimited tier has no fair-use cap: a heavy user costs $40/mo on current routing against a single-digit price

dailyAllowance returns 'unlimited' for any active paid tier; no turn ceiling, rate curve, or degradation exists anywhere for paid users. A 50-turn/day reader (~3 sessions) = 1,500 turns/mo × $0.027 (Sonnet path incl. summarizer) ≈ $40.50 COGS. At a plausible $9.99 price: −305% margin. Even on Gemini routing ($0.007/turn) heavy usage is $10.50 — break-even at best. Unlimited also carries includedPremiumTokens: 25,000 — about 5 scene calls' worth — which is never consumed by anything, confirming allowances were designed but never wired.

*Evidence:* convex/billing/entitlements.ts:97-115 (dailyAllowance → 'unlimited'), :58-63 (25k tokens, 0 images/videos); no cap logic in game.ts turn path (daily counter only enforced for non-paid via dailyAllowance count); math: 1500 × $0.027 = $40.50

#### [HIGH] A maxed free user costs $8.10/mo on the current Sonnet-first routing — one $9.99 sub subsidizes exactly one engaged free reader

Free tier = 10 turns/day (FREE_DAILY_TURNS). 300 turns/mo × $0.027 = $8.10/mo on the current routing; the same user costs $2.10 on Gemini and $0.31 on DeepSeek. At 1k MAU with the product's guest-first funnel (assume 30–40% of MAU touch the daily cap a few days/mo; realistic blended ~60 turns/mo/free user), free-tier COGS is ~$1.6k/mo on Sonnet routing vs ~$130/mo cheap-routed. With a plausible 3–5% free→paid conversion (product.md defines the funnel stages but no numeric targets), 30–50 subs × $10 = $300–500/mo revenue: the free tier alone eats it on current routing and is comfortably fundable (<10% of revenue) on cheap routing. Provider policy IS the free-tier business model.

*Evidence:* convex/billing/entitlements.ts:29 (FREE_DAILY_TURNS=10); game.ts:1052-1128 (daily_turn_counter enforced via dailyAllowance); .spec-workflow/steering/product.md §Success Metrics (funnel stages, no numeric targets); math: 300×$0.027=$8.10 vs 300×$0.007=$2.10 vs 300×$0.00103=$0.31

#### [HIGH] Guest abuse exposure: free-to-mint guest identities each get a daily allowance, and the live tunnel's dev flag unlocks full Pro media for them (~$2.50/day per guest)

Guests play without accounts-as-friction: each guest identity gets its own daily_turn_counter (10 turns/day ≈ $0.27/day text on Sonnet routing) and identities cost nothing to mint — no email, phone, or payment instrument. Worse: CYOA_DEV_FORCE_PRO_MEDIA short-circuits the Pro gate in queueSceneImage/queueSceneNarration AND resolveMediaStrategy (which then defaults to endpoint_cinematic), and per the code comments this flag is intended ON in the dev/tunnel environment — which is the currently deployed cyoa-local stack. A guest on that deployment gets stills+TTS every scene plus Omni cinematics: ~10 scenes × $0.09 + opening + chapter cinematic ($1.60) ≈ $2.50/day per identity. A trivial 100-identity script = $250/day of Google spend with zero revenue attached.

*Evidence:* convex/media/sceneMedia.ts:117,750 (devForceProMedia() bypasses entitlement); mediaStrategy.ts:117-130 ('the dev/tunnel env shows the FULL intended experience… UNSET in prod'); memory: deploy-is-dockerized (tunneled env = cyoa-local); math: 10×($0.045+$0.042) + 2×$0.80 ≈ $2.47/day

#### [MEDIUM] The `deepseek-chat` model alias is deprecated by DeepSeek on 2026-07-24 — 13 days from now — and it is the hardcoded default in three call paths

DeepSeek's official docs state deepseek-chat (and deepseek-reasoner) are deprecated 2026/07/24 15:59 UTC in favor of deepseek-v4-flash / v4-pro. The repo defaults DEEPSEEK_MODEL to 'deepseek-chat' in the scene provider, the summarizer, and the bible generator. The summarizer and bible are the only places DeepSeek actually fires today (scene path never reaches it — see risk finding), so when the alias dies, the cheapest legs of the summarizer/bible fan-out silently start failing and fall through to Anthropic/Gemini, raising per-turn cost ~10x on those calls unless DEEPSEEK_MODEL is set.

*Evidence:* convex/llm/deepseek.ts:63, summarizer.ts:194, storyBible.ts (deepseek body: readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat'); api-docs.deepseek.com/quick_start/pricing (deprecation 2026/07/24)

#### [MEDIUM] Summarizer/bible Anthropic default model 'claude-haiku-4-6' does not exist, and the shared ANTHROPIC_MODEL env var silently upgrades them to Sonnet

Two coupled defects: (1) The fallback 'claude-haiku-4-6' is not a valid Anthropic model ID (current catalog: claude-haiku-4-5 at $1/$5; there is no Haiku 4.6). With an Anthropic key set and ANTHROPIC_MODEL unset, the summarizer/bible Anthropic leg 404s on every turn and falls through to Gemini — wasted latency and a dead cost tier. (2) If the operator sets ANTHROPIC_MODEL=claude-sonnet-4-6 to pick the scene model, the summarizer and bible inherit Sonnet too (same env var), adding ~$0.0093/turn (600 in + 500 out at $3/$15) — a hidden ~35% surcharge on the scene cost. The two knobs need to be separate env vars with a real cheap default.

*Evidence:* convex/llm/summarizer.ts:230, storyBible.ts (anthropic body: readEnv('ANTHROPIC_MODEL') ?? 'claude-haiku-4-6'); anthropic.ts:65 (same env var, default claude-sonnet-4-6); claude-api skill model catalog (no haiku-4-6; haiku-4-5 $1/$5); math: (600×$3 + 500×$15)/1M = $0.0093

#### [MEDIUM] Per-scene Veo clip is the default Pro experience: $0.20/scene, $3.00 per 15-turn session — 4x the cost of everything else in the turn combined

Under per_scene_legacy (the prod default when cinematicMode is unset), every successful Imagen job schedules queueSceneVideo for that scene; dedupe is per-scene only, so every page of a Pro read gets a 4s Veo clip. The tag-gating helper (shouldQueueVideoForScene: cinematic/chapter_beat/death only) exists in veo.ts but is not what the live chain uses. A 15-turn Pro session: video $3.00 vs stills $0.68 + TTS $0.63 + text $0.10–0.41. The omni-cinematics spec (endpoint cinematics only, per-turn clip retired) is the right cost direction — 4 × $0.80 = $3.20/run but only ~once per run rather than per session-of-15-scenes — yet legacy remains the default for real Pro accounts.

*Evidence:* convex/media/sceneMedia.ts:142-145 ('Per-scene Veo is the LEGACY behavior only'), :371-395 (post-Imagen queueSceneVideo); mediaStrategy.ts:61 (absent cinematicMode → per_scene_legacy in prod); veo.ts:127-137 (tag-gated helper, unused by the chain); math: 15 × $0.20 = $3.00

#### [MEDIUM] Cost telemetry is a zero: the operator dashboard's 'AI cost per session' reads estimatedCostCents from analytics payloads that nothing populates

analytics.ts aggregates estimatedCostCents/costPerTurnCents per provider for the operator dashboard (a product.md monitoring commitment), but the turn path never writes an estimatedCostCents payload field — the accumulator adds readNumber(...)=0 forever. Provider token usage IS captured per generation (tokenUsage in generationFromText) but is dropped before analytics. You cannot manage unit economics you cannot see; this is why the Sonnet-first routing has been invisible.

*Evidence:* convex/analytics.ts:218-233 (estimatedCostCents summed from payload, costPerTurnCents derived); grep: no producer writes estimatedCostCents into analytics_events payloads in game.ts/http.ts; llm/httpClient.ts generationFromText carries tokenUsage that is never persisted to analytics

#### [MEDIUM] TTS narration has no allowance dimension at all — entitlements model images and videos but audio is structurally unmeterable today

EntitlementRecord has includedImages/includedVideos/includedPremiumTokens but no audio field, and UsageMeterRecord has no audio counter. Narration costs $0.042/scene ($30/M chars, ~1.4k chars/scene; the 5,000-char defensive cap = $0.15 max per scene) — 450 scenes/mo ≈ $19/mo per engaged Pro, comparable to the entire plausible Pro price. Any credit model must add an audio unit; today it cannot even be counted.

*Evidence:* convex/billing/entitlements.ts:13-16 (no audio allowance); paywall.ts:4-16 (no audio meter field); sceneMedia.ts:1652-1655 (5000-char cap); pricing cloud.google.com/text-to-speech/pricing ($30/1M chars, Chirp3-HD voices per ttsVoices.ts:23-30)

#### [LOW] Revenue side is entirely env-shaped: no price, tier amount, or pack SKU exists anywhere in the repo

Stripe price IDs come from four env vars (STRIPE_PRICE_{UNLIMITED,PRO}_{MONTHLY,ANNUAL}); no cents amounts, no pack products, no credit SKUs, no top-up flow. This means (a) margin cannot be asserted from code — all margin math above uses plausible $9.99/$19.99 anchors, and (b) shipping a credit/pack model requires new Stripe products + a ledger table, not just constants. The creditBalanceCents field already exists on entitlements (always 0) — a stub the spark ledger can inhabit.

*Evidence:* convex/billing/config.ts:8-30 (env-only price IDs); entitlements.ts:19 (creditBalanceCents, initialized 0, never mutated); grep: no 999/1999/amount_cents constants in convex/billing/

### Recommendations

#### [small] Tier-aware provider routing (replace the risk-only policy)

Change providerOrder to key on entitlement tier, not just risk: free/guest → DeepSeek v4-flash → Gemini 3 Flash → deterministic (never Anthropic); Unlimited → Gemini 3 Flash first (0.5–0.7¢/turn), Sonnet only for retry-on-parse-failure; Pro → Sonnet-first is defensible (2.7¢/turn is ~9% of a metered Pro turn's media COGS). This one change moves a maxed free user from $8.10 → ≤$0.31–2.10/mo and is the difference between the free tier costing ~$1.6k vs ~$150/mo at 1k MAU. Also stop hardcoding risk:'normal' or make deepseek eligibility tier-based so the cost tier is reachable at all.

#### [medium] Spark schedule with verified COGS and ~65–75% gross margin

1 spark = $0.01 face value. Charge: scene still 15 sparks (COGS $0.045–0.067 → 55–70% margin); narration 8 sparks (COGS $0.042 → 48%, or bundle 'illustrated + narrated page' at 25 sparks vs $0.09–0.11 COGS → 56–64%); Veo 4s clip 60 sparks (COGS $0.20 → 67%); Omni 8s endpoint cinematic 240 sparks (COGS $0.80 → 67%). Kill the current overage constants (25¢ image / 20¢ video / 1¢-per-1k) — they are inverted relative to cost and the video rate is at-or-below COGS in every configuration.

#### [medium] Wire the existing dead metering layer into the media queue mutations

applyUsageDelta + usage_meters are already designed with the right shape (per-account periods, spend cap, overage errors). Call applyUsageDelta from queueSceneImage, queueSceneVideo, queueSceneNarration, queueEndpointCinematic, and the anchor/NPC portrait paths BEFORE scheduling the job, and add an audioGenerations/audioChars field to the meter + an includedAudio allowance to entitlements. Enforce includedImages/includedVideos so Pro's 100/20 allowance is real: that alone cuts engaged-Pro media COGS from ~$143 to ~$8.50 + metered TTS.

#### [small] Size Pro at $19.99/mo = 1,200 included sparks + metered text

1,200 sparks ≈ 48 illustrated+narrated pages plus 2 endpoint cinematics per month (COGS ≈ $4.40 media + $4–12 text depending on routing) → 18–58% gross margin, vs today's −600%. Present it as 'about 3 fully-illustrated stories a month'; deeper usage buys packs. Keep Unlimited at $9.99 text-only with Gemini routing: typical 300 turns/mo = $2.10 COGS (79% margin), worst-case capped (below).

#### [small] Unlimited fair-use cap: 60 turns/day soft ceiling with in-fiction degradation

At 60 turns/day (≈4 full sessions) on Gemini routing, worst-case COGS is 1,800 × $0.007 = $12.60/mo — bounded near the price instead of unbounded at $40+. Past the ceiling, degrade in-metaphor ('the ink runs thin tonight') to the DeepSeek provider rather than hard-blocking, cutting marginal cost to 0.1¢/turn. The daily_turn_counter infrastructure already exists; this is a second threshold for paid tiers in dailyAllowance.

#### [medium] Spark packs: 500/$4.99, 1,200/$9.99, 4,000/$24.99

Face value ≈ $0.01/spark at the entry pack, discounting to $0.0062 at the large pack. Since spark prices carry 48–70% margin over COGS, even the discounted large pack nets ≥45% gross margin. Sell the Omni cinematic (240 sparks ≈ $1.50–2.40 effective) as the hero SKU — 'turn this ending into a film'. Reuse the existing creditBalanceCents entitlement field as the ledger seed; Stripe one-time prices via the existing env-shaped config pattern.

#### [small] Guest hardening: confirm CYOA_DEV_FORCE_PRO_MEDIA is unset on the tunnel deploy, and rate-limit guest identity minting

The flag turns every anonymous guest into a ~$2.50/day media account on the public tunnel. Verify docker-compose env now; add an IP/device-keyed limit on guest account creation (N new identities per IP per day) and require an account (not payment) before any media generation even in demo mode. Guest text exposure is then bounded at 10 × cheap-provider turns ≈ 1–3¢/day per identity.

#### [small] Migrate deepseek-chat → deepseek-v4-flash before 2026-07-24

Change the three hardcoded defaults (deepseek.ts:63, summarizer.ts:194, storyBible.ts deepseek body) or set DEEPSEEK_MODEL in the deploy env. Thirteen days out; failure mode is silent fall-through to providers 4–36x more expensive on the summarizer/bible paths.

#### [small] Fix the Anthropic model defaults: separate scene vs summarizer env vars, and use a real Haiku ID

Replace 'claude-haiku-4-6' with 'claude-haiku-4-5' ($1/$5 — summarizer turn ≈ $0.0031) and read ANTHROPIC_SUMMARIZER_MODEL / ANTHROPIC_BIBLE_MODEL with the Haiku default so setting the scene model to Sonnet no longer silently multiplies summarizer+bible cost ~3x.

#### [small] Retire per-scene Veo as the Pro default; make endpoint_cinematic the paid default

Flip the prod default for Pro from per_scene_legacy to endpoint_cinematic (opening + ending + ≤2 chapter stingers, already capped at MAX_CHAPTER_CINEMATICS_PER_RUN=2): media video COGS per RUN becomes ≤$3.20 instead of $0.20 × every scene of every session ($3.00 per 15-turn session, unbounded across sessions). Per-scene clips become a spark-purchasable upgrade, not a default.

#### [medium] Persist per-turn cost telemetry so the dashboard's cost-per-session number is real

The provider layer already returns tokenUsage per generation; multiply by a per-model rate table (constants file, updated quarterly) and write estimatedCostCents into the turn's analytics_events payload. The operator dashboard aggregation (analytics.ts:218-233) then works unchanged. Add media job costs (estimateVeoClipCostCents, OMNI constants, image/TTS constants) at queue time. Without this, none of the routing/metering changes can be verified in production.

#### [large] Board-level math to hold the plan to: 10k MAU pro-forma

Assume 4% free→paid (400 Unlimited × $9.99 = $4.0k) and 15% paid→Pro (70 Pro × $19.99 = $1.4k) → ~$5.4k MRR. Costs after fixes: free tier ~9,530 users × ~$0.15 avg = $1.4k; Unlimited 400 × $2.10 = $0.8k; Pro 70 × $8.50 = $0.6k; total ~$2.8k COGS → ~48% gross margin, positive at 10k and roughly break-even at 1k MAU. Under the CURRENT code the same 10k MAU is ~$5.4k revenue vs ~$16k+ COGS (Sonnet-routed free tier ~$8k-equivalent exposure + unmetered Pro 70 × $143 = $10k) → deeply negative. The four structural fixes above are the entire gap.


---

## Productization / GTM — Sofia

**Summary:** The Unwritten is a genuinely differentiated prototype — deterministic engine wrapping the LLM, endings map, cron-minted Daily Tale, seasons/leaderboards, a full creator/publish/fork loop, and Stripe-first billing with a real free-tier design (10 turns/day) — but it is not a product yet because everything AROUND the game is missing. There is not a single terms-of-service, privacy-policy, or content-policy document anywhere in the repo; the live deployment is literally the E2E test harness (`tests/e2e/serve-expo-web.mjs` + provider-mocks) tunneled from one machine, with the Pulumi prod stack still all placeholders; UGC moderation is seven regexes with no report button and no takedown queue; and accounts are unrecoverable (magic-link-only UI that silently degrades to a stub without RESEND_API_KEY, password path with no reset flow, no email verification). Meanwhile the product's own flagship marketing artifact — the published tale URL — unfurls with zero OG metadata, and the promised per-ending share button exists as an orphaned prop no screen ever wires. The path is web-first: roughly 4–6 weeks of unglamorous legal/hosting/moderation/auth work buys a private beta; the wedge audience is interactive-fiction readers burned by consequence-free AI fiction, and the Daily Tale plus fixed OG-unfurling tale links are the growth loop. App stores should wait until Stripe web conversion is proven — the billing normalization code exists but there is no eas.json and native has never been built.

### Findings

#### [CRITICAL] Zero legal surface: no ToS, privacy policy, content policy, or DMCA anywhere in repo or app

A repo-wide search for terms/privacy/legal files returns nothing; no /terms or /privacy route exists in apps/app/app. The product takes payments (Stripe), hosts UGC with public discovery and forking, admits 13–17 users at the age gate, and offers account data export/delete (account/index.tsx:328) — yet the age gate, publish flow, and checkout all proceed with no policy acceptance. Stripe checkout, Apple App Store, and Google Play all require a privacy policy URL; UGC publishing without a DMCA agent and acceptable-use terms is an uninsurable liability. This blocks any public launch outright.

*Evidence:* find -iname '*terms*' -o -iname '*privacy*' -o -iname '*legal*' → 0 hits outside node_modules; apps/app/app/ route listing (no legal routes); apps/app/app/account/index.tsx:328-342 (export/delete exists, no policy links)

#### [CRITICAL] The 'production' deployment is the dev/E2E harness; real hosting is placeholder-only

The live tunneled environment runs docker-compose service `app` whose command is `node tests/e2e/serve-expo-web.mjs` — a bare Node static file server built for E2E tests, with `depends_on: provider-mocks` (the mock LLM/billing service) as a hard dependency. The Pulumi prod stack is entirely placeholders: gcpProjectId `cyoa-prod-placeholder`, webDomain `example.com`, empty monitoring channels. There is no CDN, no autoscaling, no TLS at origin (tunnel.yml: noTLSVerify), and the whole thing lives on one personal machine. Between this and launch: a real Convex prod deployment, static web hosting/CDN, secrets management for live keys, and DNS.

*Evidence:* docker-compose.yml services.app.command + depends_on provider-mocks; infra/stacks/prod.yaml (all placeholder values, monitoringNotificationChannelIds: []); cloudflare/tunnel.yml ingress -> http://localhost:8081

#### [HIGH] UGC moderation is a 7-regex keyword filter with no user reporting and no operator takedown

The entire content-safety pipeline for a public UGC platform is contentPolicy.ts: 4 safety regexes (self-harm/suicide phrases) and 3 mature regexes (literally /\b(fuck|shit|bitch)\b/i, /\b(erotic|sexual|pornographic)\b/i). It is applied consistently at publish/generation boundaries (tales.ts:277, creatorFunctions.ts:196, game.ts:1292) — good architecture — but the classifier is trivially bypassed by misspelling, leetspeak, or any non-English text, and 13–17 users receive its output. There is no reader-facing report/flag button on tale, shelf, or coop surfaces (grep for report/flag/abuse in tale routes: 0 hits), no admin takedown mutation (only owner-initiated unpublishTale, talesFunctions.ts:836), and no review queue — the admin safety dashboard (apps/app/app/admin/safety) is aggregate charts only. Public shelf + fork-from-any-decision means one bad actor's content propagates.

*Evidence:* convex/contentPolicy.ts:26-37 (full pattern list); convex/talesFunctions.ts:832-836 (owner-only unpublish); grep report|abuse|takedown across convex/ and tale routes → no reporting mutation or UI

#### [HIGH] Accounts are unrecoverable and all email infra is one env-gated magic-link path

BetterAuth enables emailAndPassword with requireEmailVerification: false and configures NO sendResetPassword — a user who sets a password can never reset it. The login UI doesn't even expose the password path; it is magic-link + social only, and every method is env-gated: with no RESEND_API_KEY the magic link silently becomes a 'visual stub' that pretends to send (login/index.tsx:33-40 comment), and with no OAuth secrets zero social buttons render. Resend delivery of magic links is the ONLY email the platform can send — no verification, no receipts (Stripe covers those), no notifications, no abuse/DMCA contact channel. Launch requires: confirmed Resend prod config with a real sending domain, plus either a working password reset or removing the password path entirely.

*Evidence:* convex/betterAuth/auth.ts:27-30 (requireEmailVerification: false, no resetPassword config); convex/betterAuth/providers.ts:102-104,152-159 (all delivery gated on RESEND_API_KEY); apps/app/app/login/index.tsx:33-40 (stub fallback)

#### [HIGH] No crash reporting, no alerting, no status surface — ops is blind at launch

No Sentry/PostHog/Datadog/etc. in any package.json (consistent with the 'no third-party trackers' principle, but nothing replaces it server-side). Operator visibility is the in-house admin dashboard, which scans at most 5000 analytics rows in a 24h window (OPERATOR_DASHBOARD_MAX_EVENTS) and requires manually flagging isAdmin on an account row. All three Pulumi stacks declare empty monitoringNotificationChannelIds. There is a client ErrorBoundary but nothing reports what it catches. When the LLM provider, Stripe webhook, or Convex deployment fails post-launch, the first signal will be users leaving.

*Evidence:* grep sentry|posthog|datadog across package.json files → 0; convex/operatorDashboardFunctions.ts:35 (MAX_EVENTS=5000, 24h window); infra/stacks/*.yaml (monitoringNotificationChannelIds: []); apps/app/components/states/ErrorBoundary.tsx (local only)

#### [HIGH] Published-tale share links — the product's flagship marketing artifact — unfurl with no metadata

product.md feature 12 declares published tales 'first-class marketing artifacts', but the web build is a client-side Expo export with no +html.tsx, no meta tags, and no OG/Twitter markup anywhere in the app tree; the serve script answers every route with the generic index.html. A tale link pasted into Discord/X/iMessage — the exact viral moment the feature is designed for — unfurls as a blank card. Ironically export/marketing/og-card.png exists but is wired to nothing. A per-tale OG endpoint (title, synopsis, cover) is the single highest-leverage growth fix in the repo.

*Evidence:* grep 'og:|openGraph|twitter:card|<meta' across apps/app → 0 hits; find +html* → none; tests/e2e/serve-expo-web.mjs:33-35 (index.html fallback for all routes); export/marketing/og-card.png (unused); .spec-workflow/steering/product.md feature 12

#### [MEDIUM] Self-attested age gate with client-side-only under-13 block; minors rely on the regex filter

The age gate is an honest-answer picker (Under 13 / 13-17 / 18+); the under-13 block persists only via a client hook (useUnder13Block) so clearing storage re-admits the child, and nothing server-side prevents re-attestation. 13–17 users are promised 'General-audience stories only' (AgeGate.tsx:25) but the only enforcement between an LLM and a minor is the 7-regex filter above. Mature content is correctly triple-gated (18+ AND opt-in AND paid tier, contentPolicy.ts:141-147) — the design intent is real — but for a public launch with UGC this age architecture needs at minimum server-persisted attestation, an LLM-based safety pass, and COPPA counsel review of the guest flow.

*Evidence:* apps/app/components/account/AgeGate.tsx:23-27,40-42 (self-attest + client persistence); apps/app/hooks/useMatureOptIn.ts (useUnder13Block); convex/contentPolicy.ts:141-147 (mature triple-gate)

#### [MEDIUM] App Store path is aspirational: no EAS config, placeholder assets, IAP code with no products

No eas.json exists, so no native build has ever been configured; app.json ships version 0.1.0/buildNumber 1 with the 512px favicon reused as app icon AND splash screen. billing/apple.ts and google.ts contain real receipt-normalization code, but no IAP product identifiers are configured anywhere and there is no store metadata, screenshots pipeline (export/ has covers but no store assets), or privacy manifest. Native is correctly positioned in product.md as an acquisition surface, but treating it as launch-adjacent would add months; it should be explicitly sequenced after web.

*Evidence:* find apps/app -name eas.json → none; apps/app/app.json (icon=splash=favicon-512.png, buildNumber 1); convex/billing/apple.ts, google.ts (normalization exists, no product IDs configured in .env.example)

#### [MEDIUM] Promised per-ending share is an orphaned prop; endings map and trophy crypt have no share at all

product.md's Monitoring section promises 'per-ending share links… branching-map screenshots, account-scoped trophy room URLs' and names endings tracking as the retention moat. The death/ending panel supports an optional onShareEnding callback and renders a 'Share this ending' button when provided (Bookish.tsx:105-107) — but no host anywhere passes it (grep onShareEnding= outside death components → 0), so the button never renders. The endings map and trophy surfaces have no Share/Clipboard affordance either. The moat mechanic generates zero shareable output today.

*Evidence:* apps/app/components/death/variants/Bookish.tsx:105-107 (conditional button); apps/app/components/death/EndingPanel.tsx:47 (optional prop); grep onShareEnding= repo-wide → no callers; product.md §Monitoring & Visibility

#### [MEDIUM] QUANTIFIED (known from panel #2): metering layer is fully dead code and its overage prices are inverted ~40x against cost

Verified: UsageMeterRecord/applyUsageDelta/calculateOverageCents are referenced by no file outside convex/billing/paywall.ts (and its tests) — no mutation ever writes a usage meter, so Pro's $25/mo tier ships with unmetered media generation in practice. Quantified inversion: calculateOverageCents charges video overage at 20¢/generation vs images at 25¢/generation, while an 8s Veo clip costs roughly $1.60–$3.20 at list ($0.20–$0.40/sec) vs ~$0.03–0.04 per Imagen image — video is priced BELOW images at ~1/40th to 1/100th of cost recovery. Not re-reporting existence (logged in docs/reviews/2026-07-11-panel-review-2.md); flagging because Pro margin is a launch-pricing decision: either wire per-account caps before charging $25 or drop the overage concept.

*Evidence:* convex/billing/paywall.ts:58 (Math.ceil(premiumOver/1000) + imageOver*25 + videoOver*20); grep applyUsageDelta|UsageMeterRecord outside billing/paywall.ts → only paywall.ts; convex/billing/stripe.ts:158 (unlimited 1000¢, pro 2500¢)

### Recommendations

#### [small] Wedge audience + one-sentence pitch: consequence-starved interactive-fiction readers, on the web

Target the Choice of Games / AI Dungeon-disillusioned IF community (r/interactivefiction, IF forums, itch.io IF jams) — people who already pay $5-7 per scripted CYOA and whose stated pain (product.md: 'AI chat fiction has no consequences… scripted CYOA exposes the seams on replay') this product exactly solves. Pitch: 'A gothic living book that writes itself around your choices — real stats, real death, real endings you can share and friends can fork.' This audience forgives rough edges, evangelizes in tight communities, converts on a $10 Unlimited tier, and stress-tests the creator loop — everything the first 90 days need.

#### [small] Ship the legal minimum kit before any invite goes out

Add /terms, /privacy, and /content-policy as static routes in apps/app/app (the account page's export/delete flow at account/index.tsx:328 shows GDPR intent already exists — the documents just don't). Link them from the AgeGate footer, the publish flow (publish/[saveId]), and Stripe checkout metadata. Register a DMCA agent. Use a startup-standard template pass with counsel review of the 13-17 band and guest flow. This is days of work and it unblocks everything else.

#### [medium] Move web to real hosting: static export to CDN + Convex Cloud prod; retire the E2E server

The app is already a static Expo web export (serve-expo-web.mjs just runs `expo export --platform web` and serves files) — so the migration is mechanical: publish the export to Cloudflare Pages (already a CF shop per the tunnel setup), point EXPO_PUBLIC_CONVEX_URL/SITE_URL at a Convex Cloud prod deployment, configure live Stripe keys + RESEND_API_KEY + one LLM provider key via the existing Vault sync scripts (scripts/secrets), and fill infra/stacks/prod.yaml. Add per-tale OG meta at the same time via a Convex http.ts route or CF Pages function that serves crawler-visible HTML for /tale/:id using the existing og-card.png as fallback.

#### [medium] Moderation MVP: report button + admin takedown queue + LLM publish-gate

Three pieces, all on existing rails: (1) a `reportContent` mutation + button on tale/[taleId] and DiscoverCard writing to a reports table; (2) an admin queue view in the existing admin/safety route (gating via isAdmin already works, operatorDashboardFunctions.ts) with a takedown mutation that force-sets revoked — talesFunctions.ts:832 unpublishTale is 90% of the code; (3) replace the regex-only publish gate with one LlmRouter classification call at publish time (the router with deterministic fallback already exists, convex/llm/router.ts) keeping regexes as the fast pre-filter. Turn-time generation keeps regex-only for latency.

#### [small] Fix auth to exactly two recoverable methods: magic link + Google

Drop the password path (it has no reset flow and no UI — removing emailAndPassword from betterAuth/auth.ts:27 deletes a liability), configure RESEND_API_KEY + AUTH_EMAIL_FROM on a real domain in prod, and set GOOGLE_CLIENT_ID/SECRET (providers.ts already wires it the moment env vars exist — zero code). Add a hard failure instead of the 'sent' stub when magic link is unconfigured. Guest-first play (product principle 2) already minimizes auth pressure; two working methods is enough for beta.

#### [medium] The Daily Tale is the growth loop — make it public, comparative, and shareable

The mint cron (crons.ts:50, 00:05 UTC) with the deterministic premise bank (daily.ts) is a Wordle-shaped mechanic hiding in a card: everyone plays the SAME premise each day, and seasons.ts already has first_to_find/rarest_path leaderboards. Ship: (1) daily tale playable from the logged-out landing (guest-first flow already supports it, index.tsx:60-73); (2) a post-ending share card — 'The Lamp at World's Edge — I found the ending 4% of readers reach' — which also finally wires the orphaned onShareEnding prop (Bookish.tsx:105); (3) extend the 14-premise bank to 60+ before launch so a month of dailies is pre-reviewed.

#### [small] Wire onShareEnding + ending-rarity stat as the identity artifact

The rarest cheap win in the repo: EndingPanel already accepts onShareEnding and renders the button; endings tracking already persists unlocks. Pass a handler from ReaderScreen that copies a link/canvas card with ending title, story, and rarity %. Endings-per-account is product.md's stated emotional-investment proxy — this makes the moat metric visible and viral in one PR.

#### [medium] Cold-start content: 20-30 house premise seeds + featured daily, before any invite

Extends panel #2's house-cards idea to launch scale: the premise-seed publishing path it proposed is the right authoring rail — write 20-30 first-party premise adventures (the format the LLM continuation is best at) published as 'kept by the house', pin 3-4 as a Featured shelf above the community shelf in discover/index.tsx, and pre-publish a handful of exemplar TALES (actual completed runs) so the read/fork loop has demonstration objects on day one. A new visitor should see a full library, not the three empty states panel #2 documented.

#### [small] Launch sequence: web-only private beta → open web + paid → TestFlight; app stores last

Web-first is dictated by the repo's own state: Stripe checkout is web-mode (EXPO_PUBLIC_STRIPE_CHECKOUT_MODE=web), no eas.json exists, and guest-first play + shareable URLs only work frictionlessly on web. Phase 1: 100-500 invited IF-community members on real hosting, Stripe test mode. Phase 2: open web launch with live billing. Phase 3: TestFlight beta reusing the proven web funnel. App Store/Play submission only after Stripe conversion data justifies eating the 30% cut and review pipeline — the IAP normalization code (billing/apple.ts, google.ts) keeps that door open without blocking on it.

#### [large] 90-day arc with gates tied to metrics the repo already computes

Days 0-30 (private beta): legal kit + hosting + auth + moderation MVP; measure activation (≥5 turns) and tutorial completion — both are declared metrics in product.md and computable from analytics_events; instrument the creator funnel (panel #2's gap) before opening it. Gate: D7 retention >20% among invitees. Days 30-60 (open web + paid): flip Stripe live, launch daily share cards + OG unfurls, watch free→paid within 7 days of first paywall hit (product.md metric). Gate: any organic tale-link signups (proves the artifact loop). Days 60-90 (live-ops + native): first season event on seasons.ts leaderboards as the marketing beat, Pro media upsell in-context, TestFlight cohort. Throughout: the operator funnel dashboard is the scoreboard — fix its 5000-event/24h cap (operatorDashboardFunctions.ts:35) before beta so the numbers stay true.

#### [medium] Pricing sanity for launch: lead with Unlimited $10, hold Pro until media is capped

Unlimited at $10/mo against a 10-turn free day (FREE_DAILY_TURNS, entitlements.ts:29) is a clean, defensible ladder — the candle-gutters paywall moment is well-designed. But do not sell Pro at $25 until video generation has real per-account caps: the metering layer is dead code and its overage table prices video below images at ~1/40th of Veo's cost (paywall.ts:58). Simplest beta posture: Pro invisible or 'founding readers' invite-only with a hard N-videos/month cap enforced at the cinematics call site, and delete the overage/spend-cap machinery until usage data justifies rebuilding it.

#### [small] Minimum observability: crash reporting + one uptime probe + webhook alerting

Respect the no-third-party-trackers principle for player analytics, but ops telemetry is different: add Sentry (or self-hosted GlitchTip) to the Expo web bundle and Convex actions, a single uptime check on the prod URL + Stripe webhook endpoint with email/Discord alerting, and populate monitoringNotificationChannelIds in the prod stack. Without this, the first week of open launch is flying blind on the exact surfaces (LLM provider errors, webhook failures) most likely to break.


---

## Mobile & Store Compliance — Jonas

**Summary:** The single-codebase Expo/RNW approach is the right call and the code hygiene is genuinely good for it — 300+ accessibility props, AccessibilityInfo reduce-motion wiring, Platform guards everywhere, graceful degradation instead of crashes. But "native" here has never actually been built: the app is unsubmittable to either store today (Expo SDK 52/RN 0.76 fails Apple's iOS 26 SDK requirement in force since April 28, 2026 and Play's targetSdk 35 floor), expo-router's native peer modules and the EAS projectId are missing, no EAS profile sets the Convex URL so every store build boots in offline demo mode, and there is zero persistence on native (localStorage-only), which means a new guest account and lost progress on every cold launch. On the compliance side, the just-shipped community seed shelf plus freeform AI generation with no in-app report/flag/block mechanism is a near-certain Apple 1.2 rejection and a direct Google Play GenAI-policy violation, while Apple 3.1.1 is now actually the easy part (US external purchase links need no entitlement post-Epic). First TestFlight is a focused 2–3 week effort — SDK upgrade, storage layer, build config, UGC trust tooling — not a checkbox; ship it text-first and defer native media/push.

### Findings

#### [CRITICAL] Unsubmittable to both stores: Expo SDK 52 / RN 0.76 fails Apple's iOS 26 SDK mandate and Play's targetSdk 35 floor

The app pins expo ^52.0.0 (installed 52.0.49, RN 0.76.9). Since April 28, 2026, App Store Connect requires apps built with the iOS 26 SDK (Xcode 26) — SDK 52 tops out at Xcode 16; iOS 26 support arrived in Expo SDK 54. Google Play already requires targetSdkVersion 35 for new apps and updates (SDK 52's Android default is 34 — expo-modules-core falls back to safeExtGet('targetSdkVersion', 34)), and new apps must target 36 from Aug 31, 2026. Every native plan downstream is blocked until the app is on SDK 54+ (which also makes New Architecture effectively mandatory — the current 4-package native dep surface makes this a cheap migration).

*Evidence:* apps/app/package.json:24-31 (expo ^52.0.0, react-native ^0.76.0); node_modules/.pnpm/expo-modules-core@2.2.3/.../ExpoModulesCorePlugin.gradle (targetSdkVersion fallback 34); developer.apple.com/news/upcoming-requirements (iOS 26 SDK from 2026-04-28); developer.android.com/google/play/requirements/target-sdk (API 35 now, 36 from 2026-08-31)

#### [CRITICAL] Zero persistence on native: guest identity, saves pointer, reader settings all vanish every cold launch

lib/storage.ts returns globalThis.localStorage, which does not exist in React Native — so getLocalStorage() is null on iOS/Android and every consumer silently no-ops. useGuestSession never persists the session or guest token (readStoredSession returns null → a NEW server guest account is minted per launch, orphaning all saves, endings, entitlements); useReaderSettings, useLibrary, lockCoach, coop membership, VoicePicker and useAccountProfile all lose state the same way. No AsyncStorage/expo-secure-store dependency exists anywhere in the app. On web this is fine; on native the product is amnesiac by design of the storage shim.

*Evidence:* apps/app/lib/storage.ts:10-13; apps/app/hooks/useGuestSession.ts:177-223 (all reads/writes via getStorage()); grep: no @react-native-async-storage or expo-secure-store in apps/app/package.json

#### [CRITICAL] Store builds have no backend: EAS profiles never set the Convex URLs, and the docker/Cloudflare-Access tunnel is hostile to native clients anyway

eas.json injects only EXPO_PUBLIC_AUTH_MODE and EXPO_PUBLIC_STRIPE_CHECKOUT_MODE in all three profiles — EXPO_PUBLIC_CONVEX_URL / EXPO_PUBLIC_CONVEX_SITE_URL / EXPO_PUBLIC_APP_URL are never set, so convexClient is null in any EAS build and the whole app silently degrades to local-demo mode (RootLayout skips ConvexProvider; every gameApi call returns null). Even with the URLs baked in, the live backend is self-hosted Convex in docker behind a Cloudflare tunnel whose auth story is a browser Access session cookie (convexHttp/streamRemoteScene send credentials:'include' explicitly for 'the Access session cookie') — a native app can never complete the Access SSO dance, so an Access-gated tunnel returns login HTML/302 to every API call. Native needs a public (or service-token) API origin.

*Evidence:* eas.json build.{development,preview,production}.env; apps/app/lib/convex.ts:5; apps/app/app/_layout.tsx:27-29; apps/app/lib/convexHttp.ts:22-29 and lib/gameApi.ts:660-667 (credentials include + Access comment)

#### [HIGH] Community shelf + freeform AI generation shipped with no report/flag/block — Apple 1.2 UGC rejection and Google Play GenAI policy violation

The Discover shelf publishes pseudonymous user-authored seeds to all users, and the reader generates AI prose from freeform user text. There is no in-app mechanism to report a seed, flag offensive AI output, block a creator, or any moderation queue — grep across apps/app and convex finds no report/flag/block/takedown surface (only a publish-time safety classifier, which is filtering, not reporting). Apple 1.2 requires filtering + reporting + blocking + published contact info for UGC apps; Google Play's AI-Generated Content policy explicitly requires in-app reporting/flagging of offensive AI content without leaving the app (tightened wording effective April 15, 2026), and Play's UGC policy requires report/block as well. This is the highest-probability rejection in the current tree.

*Evidence:* convex/creatorFunctions.ts:166-315 (publish/listPublished — no report path); apps/app/app/discover/index.tsx (no report UI); grep -riE 'report|block|moderat|takedown' over apps/app + convex → zero user-facing hits; support.google.com/googleplay/android-developer/answer/14094294; Apple Review Guideline 1.2

#### [HIGH] Native build config is incomplete: router's native peer modules undeclared, expo-dev-client absent, no EAS projectId

apps/app/package.json declares only expo, expo-router, RN, safe-area-context and react-native-web. expo-router v4's native peers — react-native-screens, expo-linking, expo-constants, expo-status-bar (+ reanimated for drawer) — are not direct dependencies; they exist only via pnpm auto-install-peers deep in .pnpm (require.resolve fails from apps/app). Expo autolinking discovers native modules from the app's own dependency tree, so a prebuild would not link react-native-screens' native code (runtime crash on first Stack render). The eas.json development profile sets developmentClient:true but expo-dev-client is not installed, and app.json has no extra.eas.projectId, so `eas build` fails before any of the above even matters. Net: no native binary has ever been produced from this tree.

*Evidence:* apps/app/package.json:16-31; require test: expo-constants/expo-linking/react-native-screens/expo-status-bar 'MISSING' from apps/app; expo-router@4.0.22 peerDependencies; eas.json development.developmentClient; app.json (no extra.eas.projectId)

#### [HIGH] Native paywall is a dead preview — 2.1 rejection bait — while the actually-available 3.1.1 paths go unused

On native, onSubscribeTier short-circuits to a text preview ('Native subscriptions route through the platform store (StoreKit / Play Billing)') — a visible, non-functional subscribe surface, which Apple routinely rejects under 2.1/2.3 as incomplete. Meanwhile the compliance landscape moved: after Epic v. Apple (appeal lost, Supreme Court stay denied), guideline 3.1.1 on the US storefront permits external purchase buttons/links with NO entitlement required — so the Stripe-first model has a legal native path in the US; non-US storefronts still require IAP or the reader-app pattern (no purchase UI at all, à la Kindle). Shipping the current stubbed board is the one option that satisfies neither.

*Evidence:* apps/app/app/paywall/index.tsx:67-75 (isNative preview stub); developer.apple.com/news/?id=9txfddzf (updated 3.1.1/3.1.3 — no entitlement on US storefront); 9to5mac.com/2025/05/01/apple-app-store-guidelines-external-links/

#### [HIGH] The entire paid media stack (Pro tier's differentiators) renders nothing on native

AudioMix's playback hook is explicitly web-only (HTMLAudio; 'On native this is a no-op placeholder'); SceneCinematic's video surface returns null on native ('no expo-av dep is wired'); VeoCinematic renders a 'Cinematic ready' text card instead of the video; no expo-av/expo-video/expo-audio dependency exists. product.md also promises background ambient audio and lock-screen quick-resume as native selling points — there is no UIBackgroundModes audio entry in app.json and no audio engine to background. A native Magus/Pro subscriber would pay $25/mo for illustrated scenes only; cinematics and soundscapes silently don't exist, which is both a product integrity problem and App Review metadata-accuracy risk if screenshots show cinematics.

*Evidence:* apps/app/components/media/AudioMix.tsx:88-100; components/media/SceneCinematic.tsx:125-160; components/media/VeoCinematic.tsx:31-60; app.json ios (no infoPlist/UIBackgroundModes); .spec-workflow/steering/product.md:43

#### [MEDIUM] Token streaming is web-only: RN fetch has no ReadableStream body, so native readers silently fall to a 3.5s poll loop

streamRemoteScene uses the global fetch and response.body.getReader() (gameApi.ts:669). React Native's fetch (XHR-backed) never exposes response.body, so the guard `if (!response.ok || !response.body) return false` makes every native stream 'fail' instantly; useTurn then falls back to its 3.5s-interval / 60s-timeout scene poll. The reader technically works but the flagship streaming-prose UX degrades to chunky page pops and each turn burns a dead POST first. Expo SDK 52+ ships `expo/fetch` with real streaming response bodies on iOS/Android — a one-import fix once the SDK upgrade lands.

*Evidence:* apps/app/lib/gameApi.ts:660-690; apps/app/hooks/useTurn.ts:365-420 (stream open + POLL_INTERVAL_MS 3500 / POLL_TIMEOUT_MS 60000 fallback); docs.expo.dev expo/fetch streaming support

#### [MEDIUM] Deep links won't reach the native app: scheme-only config, and share URLs are built from window.location

app.json declares scheme 'cyoa' but no ios.associatedDomains and no android.intentFilters, so published-tale URLs and co-op invite links (https://<tunnel-host>/coop?room=…&t=…) open the browser, never the app — universal links/App Links are unconfigured. Worse, invite URL construction depends on window.location; on native the fallback returns a relative path '/coop?room=…' which is useless as a shared invite, and the copy path uses navigator.clipboard (absent on RN — needs expo-clipboard). Same window.location.origin pattern gates checkout success/cancel URLs and account portal returns, so those flows are also web-only.

*Evidence:* apps/app/app.json (scheme only); apps/app/app/coop/index.tsx:89-98, 242-247; apps/app/app/paywall/index.tsx:114-120; apps/app/app/account/index.tsx:119-134

#### [MEDIUM] Age rating: mandatory new Apple questionnaire (13+/16+/18+) intersects badly with unfiltered-AI + optional mature content

Apple's overhauled age rating system (13+/16+/18+ tiers) is mandatory — the questionnaire now asks specifically about in-app controls, user-generated content, and AI capabilities; incomplete questionnaires block submissions since Jan 31, 2026. This app has a 13+ gate (under-13 blocked in useGuestSession), an 18+ mature-content toggle, open-ended LLM generation, and UGC — honestly answered, that lands 16+ or 18+, and the mature toggle must be verifiably gated to 18+ accounts (it is server-side: shelf excludes mature for non-18+). Google Play similarly needs the AI-generated content declaration in the console. Not a code change, but decide the target rating before writing store metadata — an 18+ rating materially changes the acquisition funnel the product docs assume.

*Evidence:* apps/app/hooks/useGuestSession.ts:96-105 (under_13 block); convex/creatorFunctions.ts:228-231 (mature-excluded shelf); developer.apple.com/news/?id=ks775ehf; developer.apple.com/news/upcoming-requirements/?id=07242025a

#### [LOW] App icon/splash are a 512px RGBA favicon — below Apple's 1024 requirement and shared across all slots

ios.icon, the root icon, the adaptive-icon foreground AND the splash image are all the same 512x512 RGBA marketing favicon. Expo requires a 1024x1024 icon to generate the App Store marketing icon (a 512 source gets upscaled — visibly soft on the store page), the alpha channel must be flattened for iOS, and a favicon-as-splash produces a tiny centered logo. Cosmetic, but it's the first thing App Review and users see, and it reads as 'web app in a trenchcoat'.

*Evidence:* apps/app/app.json icon/splash/ios.icon/android.adaptiveIcon all → assets/design/marketing/favicon-512.png; file output: 'PNG image data, 512 x 512, 8-bit/color RGBA'

#### [LOW] No list virtualization anywhere — fine today, a scaling cliff once the shelf/endings/history grow

There is not a single FlatList/SectionList/FlashList in the app; every collection (community shelf, endings crypt with W3 ghost entries, library, choice history route) is a ScrollView + .map(). On native, that mounts every row's views up front — acceptable at today's content volume (bounded shelf scans, short histories), but the endings map and a successful community shelf will hit memory/TTI problems on mid-range Android well before web feels it. Flagging as a known debt to take deliberately, not an emergency.

*Evidence:* grep FlatList|SectionList|FlashList|VirtualizedList over apps/app → 0 hits; apps/app/app/discover/index.tsx, app/endings/index.tsx, app/read/[saveId]/history/index.tsx (ScrollView+map)

### Recommendations

#### [medium] Upgrade to Expo SDK 54 / RN 0.81 before any other native work

Nothing ships to either store from SDK 52 (iOS 26 SDK + targetSdk 35/36 requirements). The native dependency surface is tiny (router, screens-via-peers, safe-area-context), so this is one of the cheapest SDK jumps this codebase will ever have — do it now, enable New Architecture in the same pass (it's the SDK 54 default and legacy arch is being frozen upstream), and pick up expo/fetch, expo-video, expo-audio eligibility for free.

#### [medium] Make lib/storage.ts real on native: AsyncStorage-backed with a synchronous hydration cache

Keep the existing sync getItem/setItem surface (10+ call sites assume sync) by hydrating an in-memory Map from @react-native-async-storage/async-storage at app boot behind a splash gate, writing through asynchronously; put the guest token in expo-secure-store instead. This single change fixes guest identity, saves, reader settings, lock coach, coop membership and library persistence on native at once — without it every native session is a fresh anonymous account and the backend accumulates orphan guests.

#### [medium] Fix the EAS build pipeline: declare native deps, projectId, and per-profile backend URLs; give native a public API origin

(1) Add react-native-screens, expo-linking, expo-constants, expo-status-bar, expo-dev-client (and reanimated if drawer is used) as direct dependencies of apps/app so autolinking sees them; (2) run eas init to stamp extra.eas.projectId; (3) set EXPO_PUBLIC_CONVEX_URL / EXPO_PUBLIC_CONVEX_SITE_URL in every eas.json profile; (4) expose the docker Convex /api and /llm routes on a hostname NOT gated by Cloudflare Access browser SSO (public route or a service-token header the client attaches) — a store binary cannot do the Access cookie dance. Then produce one dev-client build on a physical iPhone and Android device as a smoke gate; this codebase has never executed off react-native-web.

#### [medium] Ship UGC + GenAI trust tooling before any TestFlight with the shelf enabled

Minimum bar for Apple 1.2 and Play's GenAI/UGC policies: a Report action on every community shelf card and published tale, a flag-this-output affordance on AI-generated scenes (a small 'flag' icon in the reader chrome is enough), block-creator that client-side hides their seeds (server field + shelf filter), a convex moderation queue table an admin can action from the existing admin dashboard, and a support contact link in Settings. The publish-time safety classifier already covers the 'filtering' prong — reporting and blocking are the missing two, and they're the cheapest rejection insurance you can buy.

#### [small] Native monetization v1: reader-app pattern now, US external-purchase links as a fast follow, StoreKit later

Delete the dead native subscribe preview and hide purchase CTAs on native — account state syncs, so users who subscribed on web get their tier (Kindle/Netflix pattern, fully compliant everywhere). Fast follow: on the US storefront, 3.1.1 now permits external purchase links with no entitlement post-Epic — a 'Manage patronage on the web' link to the existing Stripe checkout is legal and preserves the Stripe-first model. Only invest in StoreKit/Play Billing when non-US native conversion actually matters; don't block TestFlight on IAP.

#### [small] Swap streaming to expo/fetch once on SDK 54

Replace the global fetch in streamRemoteScene (and only there) with `import { fetch } from 'expo/fetch'`, which supports ReadableStream response bodies on iOS/Android — token streaming then works natively and the 3.5s poll loop becomes the genuine fallback it was written as. Keep the poll fallback; it's also covering the documented cloudflared-buffering web failure mode.

#### [large] TestFlight v1 as a text-first reader; defer native media to a post-launch wave

The reader, choices, library, endings and daily loop all work without the media stack, and the graceful no-op guards mean nothing crashes. Ship TestFlight without cinematics/audio, and gate Pro upsell copy on native accordingly so you're not advertising features the platform build lacks. The eventual native media wave is expo-video (Veo clips, already 16:9-composed) + expo-audio (five-layer mix maps cleanly onto AudioPlayer instances) + UIBackgroundModes audio — a real project, not a prerequisite.

#### [medium] Wire universal links / App Links and platform share for tale + co-op URLs

Add ios.associatedDomains (applinks:<prod-host>) and android.intentFilters for /tale and /coop paths, replace window.location-derived invite URLs with an EXPO_PUBLIC_APP_URL-based builder that works on all platforms, and use expo-clipboard/Share.share instead of navigator.clipboard. Defer until sharing is a growth lever, but do it before promoting co-op — a co-op invite that can't open the app kills the feature.

#### [small] Do the store-metadata compliance pass deliberately: age rating, AI declarations, privacy labels

Decide 16+ vs 18+ up front (mature toggle argues 18+ unless it's removed from native builds), complete Apple's new age-rating questionnaire honestly on UGC/AI questions, file Play's AI-generated-content declaration, and write the privacy nutrition labels — the SDK surface is mercifully small (Convex + better-auth: account identifiers, user content; no ads/tracking SDKs), so labels are cheap if done now and expensive if reverse-engineered under rejection pressure. Replace the 512px favicon-as-everything with a proper 1024 flattened icon and a real splash in the same pass.

#### [medium] Add a native CI smoke build to stop web-only drift

Everything found here accumulated because only `expo start --web` and Playwright ever ran. Add a CI job that runs `expo prebuild` + a release-configuration compile (EAS build --profile preview on a schedule, or xcodebuild/gradle on runners) so a PR that adds a DOM global at module scope or an undeclared native dep fails before merge. The Platform-guard discipline in this codebase is good; give it a build that enforces it.

#### [small] Keep the single-codebase RNW bet — it's the right architecture for this product

Explicit verdict on the approach question: do NOT pivot to a WebView wrapper. The code is real React Native (primitives, tokens, AccessibilityInfo, Platform.select in 32 sites), the reader UX benefits from native text rendering and will benefit from native streaming/audio, and a wrapper would inherit every store-compliance problem while adding Apple 4.2 minimum-functionality risk. The gap is operational (never built native), not architectural — close it with the items above rather than re-platforming.


---

## Backend Security & Correctness — Priya

# Backend Security & Correctness Review — The Unwritten (post-3-wave merge)\n\n## Verdict\n\nThe three merged waves are, on the whole, defensively engineered: ownership is centralized through `assertAccountSessionAccess` / `loadAndAuthorizeAccount`, the pure creator/tale/coop layers re-assert ownership independently of the wrappers (so a wrapper slip can't grant access), cross-account seed launch is gated by `canLaunchAuthoredSeed`, and public surfaces (`listPublishedPublic`, `listPublicTales`) correctly degrade rather than throw and never honor an unowned session's mature opt-in. I found **no IDOR or missing-ownership hole** on the new surfaces, and no internal mutation is externally reachable. The real exposure is elsewhere: **resource abuse** — an anonymous guest costs unbounded LLM spend because `createSave` fires a Story-Bible generation call and a turn-0 scene generation with *zero* rate limiting, and `ratelimit.ts` still only knows the daily-turn counter, which is trivially reset by minting new free guest accounts. Secondary issues: two reader/creator free-text fields (`seedTitle`, `seedTone`, and publish-time `tone`) skip `evaluateTextPolicy` yet flow verbatim into bible/scene LLM prompts; and account deletion + guest purge both leave `story_bibles`, `daily_results`, and `leaderboard_entries` orphaned (and `story_bibles` is also absent from the GDPR export). The transaction discipline (idempotency keys, `activeTurnRequestId`, re-read-before-merge in `_applyBibleRefresh`, atomic registry fold) is sound and OCC-safe.\n\n---\n\n## Critical\nNone found that are exploitable-for-data-loss right now.\n\n---\n\n## High\n\n### H1 — Guest saves have no rate limit; each one fires uncapped LLM spend outside the daily-turn cap\n`createSave` unconditionally schedules `generateStoryBible` (a full planning LLM call) for every llm-driven save (`game.ts:462-495`), and the opening turn-0 scene is generated via SSE without consuming the daily-turn counter (the counter is only decremented in `beginStreamingChoice`/`submitChoice`, `ratelimit.ts:20-40`). Nothing rate-limits `createSave` itself — only `loadAndAuthorizeAccount` runs (`game.ts:237-238`). An anonymous guest can therefore loop create-save → bible call + turn-0 generation + summarizer schedule indefinitely, none of it charged against the 10-turn free allowance. `ratelimit.ts` covers *only* the per-account daily turn counter; `createSave`, `createDraft`, `publish`, `remix`, and `createRoom` have no ratelimit coverage at all.\n*Evidence:* `convex/game.ts:462-495` (bible schedule), `convex/ratelimit.ts:20-40` (sole rate primitive), `convex/game.ts:237-238` (createSave auth only, no limiter).\n\n### H2 — The daily-turn cap is per-account and guest accounts are free to mint, so the paywall's core metric is bypassable\n`createGuestAccount` inserts a fresh account + fresh `free` entitlement on any new `guestTokenHash` with no captcha/throttle (`game.ts:122-149`). Because the daily allowance is enforced per-account (`consumeTurn` reads a per-account `daily_turn_counter`), a client that rotates its guest token gets a brand-new 10-turn allowance each time. Combined with H1 this means neither the turn cap nor cost is enforceable against a determined anonymous client. This is inherent to the tokenless guest model but is now the load-bearing gate for the free→paid funnel.\n*Evidence:* `convex/game.ts:122-149`, `convex/ratelimit.ts:29`, `convex/lib/authz.ts:35-63` (guest-token session model).\n\n---\n\n## Medium\n\n### M1 — `seedTitle` / `seedTone` (and publish-time `tone`) skip `evaluateTextPolicy` yet flow into LLM prompts\nIn `createSave`, `seedPremise` and each `seedNpcs[].description` are run through `evaluateTextPolicy` and hard-blocked (`game.ts:255-263`, `321-323`), but `seedTitle` and `seedTone` are only length-checked (`game.ts:267-280`). Both are persisted and then injected verbatim into the Story-Bible prompt — `storyTitle: save.seedTitle ?? story.title` and `storyTone` (`game.ts:490-491`, embedded into the prompt as `called \"${title}\"` at `storyBible.ts:100`) — and into every scene request (`game.ts:1676-1677`). Likewise, at publish the community-shelf `synopsis` is policy-checked (`creatorFunctions.ts:195-207`) but `tone` is only trimmed/length-capped by `normalizeSeedPublishMetadata` (`liveCore.ts:209-213`) and then shown on the public shelf. Blast radius is bounded because scene *output* is re-classified before reaching readers (`game.ts:1807-1812`, `classifyScenePayload`), but the injection reaches the planner/narrator prompt unfiltered, and the regex classifier itself is extremely narrow (7 phrase patterns, `contentPolicy.ts:26-37`) so it would not catch prompt-injection phrasing regardless.\n*Evidence:* `convex/game.ts:267-280`, `:490-491`, `:1676-1677`; `convex/llm/storyBible.ts:100`; `convex/liveCore.ts:209-213`; `convex/contentPolicy.ts:26-37`.\n\n### M2 — Account deletion & guest purge orphan `story_bibles`, `daily_results`, `leaderboard_entries`\n`deleteAccount` cascades saves/scenes/turn_history/endings/entitlements/usage_meters/daily_counters/analytics/assets/tale_reads/tale_forks, archives authored_seeds, revokes published_tales, and closes coop rooms (`accountFunctions.ts:168-214`) — but never deletes `story_bibles` (keyed `by_saveId`), `daily_results` (`by_daily_account`, account-indexed), or `leaderboard_entries` (`by_accountId`). `purgeExpiredGuests` has the identical gap (`lifecycle.ts:102-139`). `story_bibles` holds LLM planning text derived from the user's own premise, so this is both an orphaned-rows problem and a right-to-erasure gap; it is also missing from `buildAccountExportBundle` (`accountFunctions.ts:296-360`), so the data isn't exportable either. Confirmed absent by grep in both files.\n*Evidence:* `convex/accountFunctions.ts:168-214` and `:296-360`; `convex/lifecycle.ts:102-139`; schema tables `story_bibles` (`schema.ts:491-510`), `daily_results` (`:515-523`), `leaderboard_entries` (`:403-413`).\n\n### M3 — Deleting/archiving a creator's account bricks in-progress cross-account reader saves on that seed\n`deleteAccount` archives (not deletes) the owner's `authored_seeds` (`accountFunctions.ts:188-195`). But every read/turn on a save whose `storyId` is `authored_seed:<id>` calls `loadStory`, which re-checks `canLaunchAuthoredSeed` on *every* call and throws `creator_seed_forbidden` for any seed not in `published` status (`game.ts:3740-3761`; `canLaunchAuthoredSeed` returns false unless `status === \"published\"`, `liveCore.ts:126-134`). So the moment a creator deletes their account (or merely archives a seed), all other accounts with an active run launched from that seed hard-fail on their next `getCurrentScene`/`submitChoice` — a bricked save, not a graceful read-only degrade. Note the contrast with `talesFunctions:loadTaleStory`, which deliberately does *not* re-check seed status precisely so published tales survive (`talesFunctions.ts:70-79`).\n*Evidence:* `convex/game.ts:3740-3761`; `convex/liveCore.ts:126-134`; `convex/accountFunctions.ts:188-195`.\n\n---\n\n## Low\n\n### L1 — `runLlmDrivenSubmitChoice` lacks the `activeTurnRequestId` in-progress guard its streaming sibling has\n`beginStreamingChoice` rejects a concurrent turn with `turn_in_progress` when `save.activeTurnRequestId` is set to a different requestId (`game.ts:1238`). The non-streaming `submitChoice` → `runLlmDrivenSubmitChoice` path calls `consumeTurn` and advances with no such guard (`game.ts:4177-4225`); it relies solely on the requestId idempotency cache (`game.ts:1043-1051`). Two concurrent submits with *distinct* requestIds on the same save would both proceed. Convex OCC will serialize the `daily_turn_counter` write so the budget isn't double-spent, and a well-behaved client sends one requestId, so impact is limited — but the two turn paths have asymmetric concurrency discipline.\n*Evidence:* `convex/game.ts:1238` vs `:4177-4225`.\n\n### L2 — Anonymous guests can publish to the public community shelf\n`createDraft`/`publish`/`remix` authorize via `assertAccountSessionAccess`, which accepts guest-kind accounts (`creatorFunctions.ts:73-86`, `:179-217`; `authz.ts:35-45`). A guest (7-day TTL, freely minted per H2) can thus push content onto the public shelf (`listPublishedPublic`) that outlives nothing and is attributed to a throwaway pseudonym. Content is policy-gated per field (`creator.ts:247-289`), so this is an abuse/moderation surface rather than a safety hole, but publishing rights probably shouldn't extend to unclaimed guests.\n*Evidence:* `convex/creatorFunctions.ts:73-86`, `:179-217`; `convex/lib/authz.ts:35-45`.\n\n---\n\n## Prioritized fix list\n1. **H1/H2 — Put a rate limiter in front of `createSave`, `createGuestAccount`, and the bible-generation schedule** (per-account and per-source-IP/token throttle); gate turn-0 bible + scene generation behind the same budget primitive so guest LLM spend is bounded. This is the only finding with real, immediate cost/DoS exposure.\n2. **M1 — Route `seedTitle`, `seedTone`, and publish-time `tone` through `evaluateTextPolicy`** at the same sites `seedPremise` uses (`game.ts:267-280`, `creatorFunctions.ts` publish), closing the free-text-into-prompt gap.\n3. **M2 — Add `story_bibles`, `daily_results`, `leaderboard_entries` to both `deleteAccount` and `purgeExpiredGuests` cascades, and `story_bibles` to `buildAccountExportBundle`.** Best done by hoisting the two cascades into one shared helper (the lifecycle code already flags this TODO).\n4. **M3 — Make `loadStory` tolerate archived-but-referenced seeds for existing saves** (mirror `talesFunctions:loadTaleStory`'s \"published tale is the grant\" posture, or snapshot the seed graph onto the save at launch) so a creator's deletion doesn't brick live reader runs.\n5. **L2 — Require a claimed (`kind:\"user\"`) account to publish/remix to the public shelf**; keep draft creation open to guests if desired.\n6. **L1 — Add the `activeTurnRequestId` in-progress guard to the non-streaming llm submit path** for parity."}],"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":796,"cache_creation_input_tokens":6055,"cache_read_input_tokens":257024,"cache_creation":{"ephemeral_5m_input_tokens":6055,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"not_available"},"diagnostics":{"cache_miss_reason":{"type":"model_changed","cache_missed_input_tokens":211782}}},"requestId":"req_011CcxUB5m67QBrDTwAZZnKY","attributionAgent":"general-purpose","type":"assistant","uuid":"b899cc3c-f05d-4a65-a450-9797dee008ae","timestamp":"2026-07-12T16:22:03.070Z","userType":"external","entrypoint":"cli","cwd":"/home/j/Development/CYOA","sessionId":"f7f546da-2d9b-4eb4-831a-979b5a9c1216","version":"2.1.201","gitBranch":"docs/panel-review-2"}
