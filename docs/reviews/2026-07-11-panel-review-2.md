# Panel Review #2 — Full Findings (2026-07-11)

Second multi-persona PM/UX/AV review, run against the `feat/creator-arc` tree
(post story-bible, post creator-arc — PR #3 merged, PR #4 open). Five personas
in parallel + a principal-engineer synthesis that VERIFIED every top critique
against the code. This document is the complete, unabridged output — the
follow-up work will be sequenced from here.

Related: panel #1 (2026-07-10) produced the story-bible spec and the shipped
quick wins; its detail survives only in the spec docs and PR #3/#4
descriptions. This file exists so panel #2 does not suffer the same fate.

Status of proposals: NOT committed to. The synthesis "waves" at the bottom are
a recommendation awaiting founder decision. The daily-killcam and act-mementos
specs (drafted, approval pending on the spec dashboard) overlap some ideas —
see verdicts marked `already-planned`.

---

## Persona: Dana — staff engineer, post-ship product-quality integration review of the story-bible + panel quick wins + creator arc week

**Summary:** The server-side depth of this week is genuinely good — the bible registry fold, the fixpoint linter, and the dashboard aggregation are careful, well-commented, tested work. But walking the surfaces as a user exposes seams exactly where the three workstreams meet: "Begin again" (a panel quick win) silently dead-ends on both new seeded-run types (a creator-arc feature), the community shelf ships with no cold-start content and its creator gets no way to find their own pseudonymous card, and the entire creator/discover funnel fired zero analytics while the bible loop instrumented everything. The doors journal — the reader payoff for the whole bible investment — is mechanically sound but pedagogically orphaned: nothing connects the locked door a reader is staring at to the pill that just appeared above the prose.

### Critiques

#### [HIGH] "Begin again" dead-ends on exactly the runs shipped this week (seeded + community-seed runs)

The panel-review fix routes Begin again through useLibrary.createSave(storyId, "story", undefined, ...) with no titleOverride and no seed payload. createSave resolves the title from listStarterStories(), which deliberately EXCLUDES the open-canvas shell (hiddenStarters) and can never contain authored_seed:<id> storyIds. So: (a) a community-shelf run (storyId "authored_seed:<id>") throws story_not_found client-side and the catch silently dumps the reader on the cover page — the button works only for the 4 bundled starters; (b) a SeedStoryFlow premise run restarts OPEN_STARTER_ID with NO seedPremise/tone/NPCs even if the title lookup were fixed, producing a blank open-canvas story instead of "the same story" the comment promises. Both failure modes hit the creator arc's own flagship flows (Discover launch, seeded adventures) — the ending-panel loop the walk was supposed to close breaks precisely where the two new features meet.

*Evidence:* apps/app/components/reading/ReaderScreen.tsx:344-368 (createSave(storyId,"story",undefined,...)); apps/app/hooks/useLibrary.ts:116-123 (title=starterStories lookup → throw story_not_found); packages/stories/src/index.ts:29-37 (openCanvas is a hiddenStarter, absent from listStarterStories()); useLibrary.ts:170-177 (seed fields only sent when the caller passes them)

#### [HIGH] Community shelf has no cold-start plan; Discover renders three empty states in a row for a fresh account

Nothing seeds listPublishedPublic — no first-party/house seeds exist, and the empty-state copy asks the *reader* to become a creator ("Publish one from the creator desk"). Directly below it, the tales archive is hardcoded empty (tales = useMemo(() => [], [])) with a second EmptyState, and PublishableShelf is empty for a fresh account too. The one thing a new visitor CAN act on — the template cards — sits at the very bottom, below two shelves of nothing. Walk 4's second account only sees content if walk 3's creator already published; on a fresh deployment the flagship social surface is a wall of lore-voiced apologies.

*Evidence:* apps/app/app/discover/index.tsx:166 (tales always []), 204-209 (community empty state), 279-285 (archive empty state), 292-323 (templates last); convex/creatorFunctions.ts:256-315 (no system/house seeds concept)

#### [MEDIUM] The creator publish loop doesn't close: no path from "published" to seeing your seed live or attributing it to yourself

After a public publish the status line says "Seed published to the community shelf" but the primary follow-up CTA is "Open in library"; Discover is only reachable via the static "After publishing" sidebar. On the shelf the seed appears as "kept by <pseudonym>" — creatorHandle exists only server-side, the publish response doesn't return it, and listPublishedPublic carries no isMine flag — so a creator cannot even identify their own card among others (and tapping "Begin this adventure" on it mints a selfPlay run). The dashboard, the payoff surface for publishing, is linked from the drafts-shelf header but not from the publish-success moment. Req 22.4's "analytics one hop from the shelf" is met literally, but the emotional loop (publish → see it live → watch readers arrive) requires the creator to reverse-engineer their own pseudonym.

*Evidence:* apps/app/app/creator/index.tsx:409-415, 818-822 (Open in library as the only published CTA), 829-838 (static sidebar); convex/liveCore.ts:143-158 (creatorHandle never sent to its owner); convex/creatorFunctions.ts:305-313 (no isMine on shelf items)

#### [MEDIUM] Zero analytics events for the entire creator/discover funnel

The story-bible work instrumented its loop thoroughly (bible.generated/attached/key_promised/key_seeded/gate_phantom_unlocked, choice.locked_shown), but the creator arc fired only creator.play_time. There is no event for draft created, seed published (or visibility chosen), template picked, community-shelf launch, remix, dashboard visit, or doors-journal open/key-arrival. Steering's creator-loop health metrics ("tales published per active account", "average reads per published tale") and the remix/template conversion questions the next iteration will ask are unanswerable; even the doors-journal fetch-quest payoff (the thing choice.locked_shown was built to baseline) has no client-side engagement signal.

*Evidence:* convex/creatorFunctions.ts (no analytics_events inserts anywhere in create/update/publish/remix/archive); apps/app/components/reading/DoorsJournal.tsx (no event on expand/nudge); contrast convex/game.ts:3448-3452 and .spec-workflow/steering/product.md §Success Metrics ("Tales published per active account + average reads per published tale")

#### [MEDIUM] Dashboard misleads at low data and undercounts the revenue-share signal at high data

Two trust seams in getSeedStats: (1) quit points require a save stale for 48h (QUIT_STALE_AFTER_MS), so for the first two days after publishing the histogram renders "No stalled runs yet — nobody has drifted away mid-story" — an affirmatively false claim when readers quit yesterday; those same readers are simultaneously counted under "Still reading". (2) playSeconds/externalPlaySeconds aggregate only the most recent 4096 creator.play_time events across ALL creators; once platform volume crosses that window, every creator's lifetime "Reader time" — explicitly documented as the Req 22.5 revenue-share input — silently shrinks. The comment acknowledges the index gap but a decaying money-adjacent number is worse than a slow query.

*Evidence:* convex/creatorDashboard.ts:51 (48h), 64 (EVENT_SCAN_LIMIT=4096), 366-371 (bounded desc window feeds cumulative totals); apps/app/app/creator/dashboard.tsx:208-210 ("nobody has drifted away" copy)

#### [MEDIUM] Doors journal is discoverable only by accident, and its labels come from the plan, not the page

The reader half of the fetch-quest loop is two disconnected surfaces: the locked-choice card (bottom of screen) teaches "the story will show you how" but never points at the journal pill that just appeared at the top of the screen; the one-shot key-arrival toast says "A key has turned up." without naming the door or pointing anywhere. Meanwhile projectDoorsJournal renders `doors[0]?.label ?? key.label` — the bible's internal lockPlan planning label — while what the reader actually saw on screen was the LLM's gate label/lockedHint, which the registry rule does not force to match. A journal entry like "The crypt gate remembers you" for a gate the LLM rendered as "Force the rusted door" reads as content the reader never encountered — the exact perceived-quality failure BC10's "reader-seen-only" gate was meant to prevent, just via label drift instead of leakage.

*Evidence:* apps/app/components/choices/lockCoach.ts:14 (LOCK_COACH_COPY has no pointer); apps/app/components/reading/DoorsJournal.tsx:66 (anonymous toast); convex/llm/storyBible.ts:405 (plan-label projection); prompts/scene.ts:490 (registry rule constrains ids, not door labels)

#### [LOW] Creator form flattens every loaded story to the fixed 2-scene shell — remix is silently lossy and all community 'adventures' are one choice deep

formValuesFromStory extracts only title/opening/2 choice labels, and buildCreatorStory rebuilds the hardcoded start+2-endings graph with stock endings ("A Clear Route"/"The Lantern Goes Out") and stock effects. Today all seeds come from this form so nothing is lost yet, but the moment any richer authored_seed exists (API, future editor), load-or-remix + save destroys its graph with no warning. Product-level consequence now: every community-shelf "adventure" is exactly two LLM scenes with identical ending structure, the dashboard's ending distribution shows labels the creator never wrote, and the quit-point histogram is nearly meaningless over runs that cap at ~2 turns — the analytics surface is dressed for stories the authoring surface cannot produce.

*Evidence:* apps/app/app/creator/index.tsx:127-140 (formValuesFromStory), 864-931 (buildCreatorStory fixed shell); convex/creatorFunctions.ts:353-358 (remix copies full story, but the only editor flattens it)

#### [LOW] Template prefill is mount-locked and template slugs collide with starter story ids in analytics

creator/index.tsx locks initialForm to the mount-time ?template= param (useMemo with [] deps, explicitly "deliberately locked"), so any navigation that reuses a mounted creator screen (back-stack return, param-only change on web) shows a stale/blank form after tapping "Begin from this template". Separately, an unedited template title ("Bone Cathedral") slugifies to story.id "bone-cathedral" — the real starter's id — and buildPlayTimeAttributionEvent prefers the seed's inner story JSON id for the analytics storyId, so creator.play_time rows from such seeds pollute the actual starter's per-story analytics (dashboard aggregation is safe via payload.authoredSeedId; operator/story-level cuts are not).

*Evidence:* apps/app/app/creator/index.tsx:165-171 (mount-locked useMemo), 933-936 (slugify); convex/creatorDashboard.ts:126-130 (event.storyId from inner story JSON); packages/stories/src/index.ts:22-26 (boneCathedral starter id)

### Ideas

#### [high impact / small effort] Server-side "restart this run" that copies seed identity from the ended save

Add game:restartRun (or widen createSave with a fromSaveId arg): server loads the ended save, copies storyId + seedPremise/seedTitle/seedTone/seedNpcs/voiceId onto a fresh save, and returns it. The ending panel calls it with just {saveId}, eliminating the client-side starterStories title lookup entirely. The save row already persists every seed field (game.ts:375 stores seedPremise; 1639/4235 read it back), so this is a read-copy-insert on existing schema and fixes both Begin-again failure modes in one mutation.

*Builds on:* convex/game.ts createSave + saves seed fields; ReaderScreen.beginAgain

#### [high impact / medium effort] Let readers publish their SeedStoryFlow premise adventures to the community shelf

The rich creator surface everyone actually uses — premise/tone/NPC-cast seeded open-canvas runs — has no path to the shelf; only the thin 4-field rule-seed form publishes. Store a second authored_seeds kind: {kind:"premise", premise, tone, npcCast} with the same publish metadata panel (synopsis/visibility/forkPolicy already built), and have the Discover launch path call createSave(OPEN_STARTER_ID, ..., {premise,...}) exactly as SeedStoryFlow does today (useLibrary already threads all fields). This fills the shelf with the seed type the LLM continuation thrives on, makes remix meaningful (edit the premise, not two choice labels), and largely solves the cold-start problem organically.

*Builds on:* SeedStoryFlow + useLibrary.createSave seed args + creatorFunctions.publish metadata + listPublishedPublic

#### [medium impact / small effort] Seed the shelf with launchable "house" cards from the starter stubs

listCreatorTemplates() already projects bone-cathedral/iron-court/ashfall into card shape. Until real creators arrive, blend them into the community shelf as "kept by the house" cards whose Begin button launches the starter directly (library.createSave(template.id, ...) — these ids ARE in starterStories so it works today) and whose Remix routes to /creator?template=<id>. Pure client change in discover/index.tsx: the shelf is never empty, the empty-state copy stops asking newcomers to become creators, and templates stop being buried below two empty shelves.

*Builds on:* apps/app/lib/creatorTemplates.ts + discover community-shelf render + useLibrary.createSave

#### [medium impact / small effort] Close the publish loop: return the creator's handle + shelf deep link, and stamp isMine on shelf cards

creatorFunctions.publish already computes everything needed — have it return { ownerHandle: creatorHandle(ownerAccountId) } and have the success state render "Shelved as <handle> — See it on the shelf / Watch readers arrive" with router.push('/discover') and '/creator/dashboard'. In listPublishedPublic, compare seed.ownerAccountId to the (already session-verified) viewer accountId and emit isMine so Discover can render a "yours" chip and suppress/relabel the selfPlay-generating Begin button on your own card.

*Builds on:* convex/liveCore.creatorHandle + creatorFunctions.publish/listPublishedPublic + creator index publish success state

#### [medium impact / small effort] Instrument the creator funnel with the existing analytics_events discipline

Reuse the fire-and-forget insert pattern from game.ts insertStoryAnalytics / storyBible's bible.* events: creator.draft_created, creator.published {visibility, fromTemplate?, remixOf?}, seed.launched {seedId, external}, seed.remixed, doors.journal_opened / doors.key_nudged (client → a lightweight logClientEvent mutation, or piggyback on the getDoorsJournal query's turn analytics). This makes the phantom-gate-style baseline possible for the creator loop (publish→launch conversion, remix rate, journal engagement) and directly feeds the steering metrics that currently have no data source for seeds.

*Builds on:* convex/game.ts insertStoryAnalytics pattern + analytics_events by_eventName index + creatorDashboard's aggregation approach

#### [medium impact / small effort] Wire the locked-door surfaces into one teaching loop

Three one-line changes make the fetch quest legible: (1) when a lock renders AND the save has a bible, LockedChoiceCopy appends "The tome will remember this door." (the projection already knows the gate got registry-promised — thread a `remembered: true` flag through choiceVisibilities); (2) LOCK_COACH_COPY points upward: "…watch the doors the tome remembers, above."; (3) the key-arrival toast names its door: doorsNewlyKeyed already returns the entries, so "A key has turned up — <label>." and tapping the toast expands the pill. Also project the reader-seen lockedHint (already stored per gate via choice.locked_shown flow) as the journal label instead of the bible's internal lockPlan label, killing the plan-vs-page drift.

*Builds on:* DoorsJournal + lockCoach + LockedChoiceCopy + saves.ts choiceVisibilities projection + projectDoorsJournal

#### [medium impact / medium effort] Make dashboard play time durable: per-seed running totals instead of a bounded event scan

insertCreatorPlayTimeAttribution already touches the seed doc (ctx.db.get) on every attributed turn — extend it to also patch running counters on the authored_seeds row itself (playSecondsTotal, playSecondsExternal, lastPlayedAt), keeping the raw events for audit. getSeedStats then reads exact lifetime totals off the seed doc with zero scans, the 4096-window decay disappears, and the revenue-share number becomes append-only-correct. While in there, drop QUIT_STALE_AFTER_MS to ~6h for seeds under 50 plays or swap the zero-state copy to "Too soon to tell — quit points appear once a run has sat idle for two days."

*Builds on:* convex/creatorDashboard.ts insertCreatorPlayTimeAttribution + authored_seeds table + getSeedStats

#### [medium impact / small effort] Give the doors journal a home in the ending panel's ConsequenceReel

The journal state dies with the run today — doors still teased at a terminal are exactly the "what might have been" hook the endings surfaces trade in. On terminal panels, feed projectDoorsJournal's still-teased entries into the existing ConsequenceReel/WhatMightHaveBeen slot ("Two doors stayed shut: The crypt gate…"), and let Begin again carry that as motivation copy. Server side is already built (getDoorsJournal works on ended saves — it only checks ownership); this is a client mount plus one line of panel copy, and it turns the bible's unopened lockPlan into replay pressure, the core moat metric (endings unlocked per account).

*Builds on:* getDoorsJournal + EndingPanel/ConsequenceReel + WhatMightHaveBeen ghost pattern


---

## Persona: Maya, engagement PM (round 2)

**Summary:** The gameplay-depth wave shipped real retention substance (rank, keepsakes, daily, doors journal), but the funnel around it leaks by construction at every paid-for metric in product.md: the daily-cap moment renders as a dead-end error string with no paywall route, the turn-3 soft signup prompt named in the success metrics simply doesn't exist, and /coop, /seasons, and /profile (where rank and keepsakes live) are orphaned routes with zero inbound links. Meanwhile the product has no return triggers at all — no push, no re-entry email, no streaks — despite a minted-daily-tale cron and working Resend infrastructure sitting one wire away. The highest-leverage next moves are small: wire the candle-gutter interstitial to /paywall, add the turn-3 claim ribbon, pass the already-built onShareEnding prop, and give co-op a host entry point — then invest in the streak + candle-relight notification pair as the D1/D7 engine.

### Critiques

#### [HIGH] Free→paid conversion moment dead-ends: candle-gutter is an inline error string with no path to the paywall

When the daily cap bites, the reader sees only the toast-style copy 'You've used today's turns. They refresh tomorrow — or upgrade for unlimited.' set via setFreeformError — no button, no route. The reader surface (ReaderScreen.tsx and everything under app/read) contains zero references to /paywall or /login; the ONLY inbound link to /paywall in the entire app is a button on /account (account/index.tsx:302). So the single highest-intent moment in the funnel — product.md's 'Free → paid: % of accounts that subscribe within 7 days of first hitting the daily-turn paywall' — requires the player to independently discover Account → Patronage. This also violates Principle 8 ('daily turn caps are a narrative event, not an error message') and Principle 7 (no server API exposes turnsUsed/remaining, so the player gets no warning before the cap hits mid-scene).

*Evidence:* apps/app/hooks/useTurn.ts:927-928 (copy, no CTA); useTurn.ts:483-492 (error → setFreeformError only); grep: app/read + ReaderScreen.tsx have no 'paywall' hits; apps/app/app/account/index.tsx:302 is the sole push("/paywall"); product.md Success Metrics 'Free → paid' + Principles 7-8

#### [HIGH] The turn-3 soft signup prompt — a named product.md target — does not exist anywhere

product.md defines 'Guest → account: % of guests who hit the soft-signup prompt and convert (target prompt at turn 3)'. There is no such prompt in the codebase: no component, no turn-count trigger, nothing in ReaderScreen or the ending panel. The only guest→account path is the player spontaneously visiting /account and typing an email into the claim field (claimWithEmail → accountFunctions:claimGuest). The backend claim machinery is fully built (liveCore.ts buildClaimGuestPlan, accountFunctions:claimGuest) but has exactly one client entry point buried on a settings-adjacent page. The metric is unmeasurable and unmovable by construction, and guest saves silently ride a 7-day purge TTL (crons.ts purge-expired-guests) that nothing warns the player about — engaged guests can lose everything.

*Evidence:* product.md Success Metrics 'Guest → account (target prompt at turn 3)'; grep for softSignup/turn >= 3 across apps/app returns nothing; apps/app/hooks/useAccountProfile.ts:133-139 (claimWithEmail sole caller path, surfaced only at app/account/index.tsx:56); convex/crons.ts:16-24 (guest purge)

#### [HIGH] /coop and /seasons are orphaned routes with zero inbound links; seasons is a hardcoded mock over a fully-built dead backend

A route-link census across app/ and components/ finds no push/replace/href to /coop or /seasons from any surface — the AppNav is Library/Discover/Create/Account/Settings only. Co-op is a complete, tested backend (coopFunctions.ts: createRoom, joinRoom, castVote, passControl, heartbeat…) plus a full client screen, reachable only by typing the URL — so product.md's 'Co-op session rate' metric is structurally pinned at ~0 for hosts (invitees can arrive by shared URL, but nobody can become a host). /seasons renders a hardcoded leaders array ('First candle', 'Ash reader'…) while the real seasons engine (getActiveSeason, buildAchievementUnlocks, buildLeaderboardEntries, rankLeaderboard) and its schema tables (seasons, leaderboard_entries) have zero non-test callers — feature 15's entire retention loop is shelfware.

*Evidence:* grep census: no '/coop' or '/seasons' inbound links; apps/app/components/navigation/AppNav.tsx:37-45; apps/app/app/seasons/index.tsx:7-11 (hardcoded leaders); convex/seasons.ts:38-116 called only from convex/tests/seasons.test.ts; convex/schema.ts:392,403; product.md features 11 & 15, 'Co-op session rate' metric

#### [HIGH] Zero return triggers: no push, no re-entry email, no streaks — D1/D7/D30 has no lever

product.md feature 18 promises 'push notifications when the daily candle re-lights' and the retention metrics are D1/D7/D30, but the app has no expo-notifications dependency, no notification code anywhere in convex/, and crons.ts registers only purges plus the daily-tale mint — nothing that reaches out to a lapsed player. Working Resend email delivery exists (sendMagicLinkEmail) but is used solely for magic links. 'Streak' has zero hits across the repo despite the Daily Tale system (daily_tales + daily_results tables) being exactly the loop streaks attach to. Every engagement system shipped this quarter (rank, keepsakes, daily, seasons, hardcore) is a pull mechanic; the product currently relies entirely on the player remembering it exists.

*Evidence:* convex/crons.ts (4 jobs: 3 purges + mint-daily-tale); grep 'notification|expo-notifications' across convex/ and apps/app returns nothing; grep 'streak' returns only an unrelated media-ladder comment (useSceneMedia.ts:194); convex/betterAuth/providers.ts:110 (sendMagicLinkEmail, single-purpose); product.md feature 18 + Retention metric

#### [MEDIUM] The production /paywall route is still a design-review demo with fabricated data

The paywall page's own comment says reasons 'can be overridden via the segmented selector so design wave 0 review can flip through all variants' — that selector shipped to users, letting them toggle Daily limit / Pro media / Credits framing. CandleState is synthesized client-side from tier config (turnsUsed set to turnsAllowed) with a hardcoded resetsInLabel of '7h 22m' that is wrong almost all day. No server API returns actual daily_turn_counter state (getProfile and getCurrentScene expose nothing about turns), so the page cannot show truth even if it wanted to. For the surface that closes the free→paid metric, showing a fake candle undermines the 'book closes when the candle gutters' narrative the whole tier system leans on.

*Evidence:* apps/app/app/paywall/index.tsx:26-27 (demo comment), 52-57 (synthesized CandleState, hardcoded '7h 22m'), 180-213 (user-facing reason selector); grep turnsUsed/remaining in convex/accountFunctions.ts and game.ts projections: not exposed

#### [MEDIUM] Share/publish is unwired at the peak-emotion moment: EndingPanel's share slot exists but ReaderScreen never fills it

Every EndingPanel variant renders a 'Share this ending' button when onShareEnding is provided (Bookish.tsx:105, Cinematic.tsx:98), but ReaderScreen never passes the prop — grep for onShareEnding in ReaderScreen/layouts returns nothing. Publishing a tale is reachable only from the PublishableShelf on /discover (router.push(`/publish/${saveId}`)), i.e. the player must leave the story, visit a browse surface, and find their own save. product.md calls published tales 'first-class marketing artifacts' and tracks 'Tales published per active account'; the moment a player just earned an ending — the moment they'd share — offers Begin again and the trophy label, but no publish or share path.

*Evidence:* apps/app/components/death/variants/Bookish.tsx:105-106; apps/app/components/death/EndingPanel.tsx:47,127; grep onShareEnding in ReaderScreen.tsx/layouts: absent; apps/app/app/discover/index.tsx:288 (sole /publish inbound); product.md feature 12 + 'Tales published' metric

#### [MEDIUM] Librarian Rank and Keepsakes — this quarter's retention investments — live on /profile, which guests can't reach

The W3 rank chip and the keepsakes shelf render on app/profile/index.tsx, but /profile is not in AppNav (items: library, discover, creator, account, settings) and the only navigation to it is login/index.tsx:76's replace('/profile') after magic-link/social sign-in. Guests — the population rank and keepsakes are supposed to invest before the account ask — have no discoverable path to see their rank progress or earned keepsakes, and nothing in the reader or home page ever references them. The 'endings unlocked per active account' investment loop these systems feed is invisible to precisely the users it should hook.

*Evidence:* apps/app/app/profile/index.tsx:46-56 (rank chip), 59+ (keepsakes shelf); apps/app/components/navigation/AppNav.tsx:37-45 (no profile item); route-link census: /profile inbound only from login/index.tsx:76

#### [LOW] Home page treats every visit as a first visit: acquisition hero dominates, return-visit state is buried or absent

index.tsx renders the same 'Chapter Zero / A living book waits at the threshold' hero (min 280-420px tall) to a day-30 player as to a first-time guest; Continue-your-save is a secondary button below it, and nothing on the surface reflects rank, streak-equivalent, unfinished doors (DoorsJournal), or endings progress. The DailyCard is the one return hook and it's fetched once via a bare useEffect + HTTP call rather than a reactive subscription, and startRemoteDaily's result is silently discarded when accountId is briefly null. For D1/D7 the landing surface should re-anchor to 'your story so far'; today it re-sells the product to people already sold.

*Evidence:* apps/app/app/index.tsx:131-140 (daily start returns Promise.resolve(null) sans account), 142-215 (hero always first), 235-243 (Continue as secondary below hero); product.md Retention metric + Business Objective 'convert anonymous landings' (already-converted users get the same page)

### Ideas

#### [high impact / medium effort] Candle-gutter interstitial: make the daily cap a narrative event with a paywall door

In useTurn's beginRemoteStreamingChoice rejection path, branch on errorCode === 'daily_turns_exhausted' and set a new 'candleGuttered' projection state instead of setFreeformError. ReaderScreen renders a full-page panel in the ChapterEnd/EndingPanel visual family: the candle guttering, a live countdown to next UTC midnight (reuse msUntilNextUtcMidnight + formatCountdown from lib/dailyApi.ts), tonight's progress ('You read N pages today'), and two doors — 'Return when the candle re-lights' and 'Keep the candle burning' → router.push('/paywall?reason=daily_limit'). Reuses PaywallPanel's existing daily_limit variant on arrival. This is the single cheapest fix to the free→paid metric because the intent moment already exists and currently converts to a dead-end string.

*Builds on:* useTurn.ts error mapping + ChapterEnd/EndingPanel panel system + PaywallPanel daily_limit variant + dailyApi countdown helpers

#### [high impact / small effort] Real candle-state API and an in-reader burn meter from 50%

Add turns info to game:getCurrentScene's projection (it already reads daily_turn_counter in the turn path — game.ts:1054,1255): {turnsUsedToday, includedTurnsPerDay, resetsAtUtc} derived from ratelimit.ts + entitlements.dailyAllowance. Client: render CandleClock's existing inline variant (flame + fraction) in the reader top strip once burn ≥50%, matching the shipped 'candle from 50%' pattern used for pursuit clocks. Also feed the same numbers into /paywall to delete the fabricated CandleState and hardcoded '7h 22m'. Satisfies Principle 7's no-surprise-paywall rule and primes the interstitial above — players who watched the candle burn convert with less resentment.

*Builds on:* convex/ratelimit.ts + billing/entitlements.ts allowance math; CandleClock.tsx inline variant; paywall/index.tsx CandleState

#### [high impact / small effort] Turn-3 'bind this tale to your name' soft signup ribbon

ReaderScreen already has turnNumber in its projection and useAccountProfile exposes profile.kind plus claimWithEmail. At turnNumber ≥ 3 && kind === 'guest', show a one-time dismissible ribbon above the choice deck in the narrator voice: 'This tale is written in vanishing ink — bind it to your name and it keeps.' Inline email field submits claimWithEmail directly (no route change, preserving Principle 5's flow rule); dismissal persists in localStorage exactly like the shipped first-lock coach mark. Honest framing: guest saves really are purged after 7 days (crons.ts), so the copy is true, urgent, and on-brand. This creates the measurable prompt product.md's guest→account metric is defined against.

*Builds on:* ReaderScreen projection turn count + useAccountProfile.claimWithEmail + first-lock coach dismissal pattern (locked-choice UX, shipped this week)

#### [high impact / small effort] Wire the ending panel's dead share slot: publish + share at the trophy moment

Pass onShareEnding from ReaderScreen (line ~456-486 where ChapterEnd/EndingPanel props assemble, next to the existing onOpenEndings and onSeeMap handlers) as router.push(`/publish/${saveId}`). The button already renders in every EndingPanel variant the moment the prop exists — this is nearly a one-line wire plus prefilling publish metadata (title/synopsis) from the run so the flow is two taps. Add a second post-publish share step surfacing the tale URL with the ending trophy label as default copy. Targets tales-published-per-account at the exact moment product.md's 'endings unlocked = emotional investment' proxy peaks.

*Builds on:* EndingPanel onShareEnding prop (built, unwired) + /publish/[saveId] route + talesFunctions:publishTale

#### [high impact / medium effort] Daily streak with a keepsake at 7: attach a compounding return loop to the Daily Tale

Server: dailyFunctions:getToday walks the caller's daily_results rows backwards by date (table exists, schema.ts:515) and returns streakDays; O(streak) reads, capped. Client: DailyCard shows 'Day N of your vigil' with the candle glyph, and DailyResults' distribution screen shows it beside the share line. At 7 consecutive days, grant a 'Week of Vigils' keepsake through the existing keepsakes grant path so the streak physically becomes a story object the player can carry into a run — the streak reward IS gameplay, honoring 'story first'. Streaks are the classic D1→D7 bridge and the Daily Tale (shipped W3) is exactly one turn short of being one.

*Builds on:* daily_results table + dailyFunctions:getToday + DailyCard/DailyResults + keepsakes grant pipeline (KEEPSAKE_GRANTED)

#### [high impact / large effort] Candle re-light notification: the product.md-promised push, plus email fallback

New cron minutes after mint-daily-tale (00:05 UTC): notify-candle-relight fans out to opted-in accounts with today's Daily Tale title as the hook — 'The candle is lit. Today's tale: {title}.' Native: expo-notifications tokens stored on the accounts row, sent via Expo push API from a Convex action. Web/claimed accounts: reuse the Resend HTTP sender (generalize sendMagicLinkEmail in betterAuth/providers.ts into a sendTransactional helper) with a deep link that lands on the DailyCard. Opt-in prompt appears once, AFTER the player's first daily run completes (highest-affinity moment), never before — Principle 2. This is the only item on this list that reaches players who didn't open the app.

*Builds on:* crons.ts mint-daily-tale + betterAuth/providers.ts Resend sender + dailyFunctions:getToday deep link; product.md feature 18's explicit promise

#### [medium impact / medium effort] 'Your tale continues' re-entry email for abandoned saves

Weekly-ish cron (pattern-match purge-expired-guests' bounded sweep) selects claimed accounts whose most-recent save has turnNumber ≥5 and updatedAt 48h-7d stale, pulls the last turn_history row's scene title + the DoorsJournal's unopened-door count, and sends one narrator-voiced email: 'You left {title} at {scene}. {N} doors remain unopened.' → /read/{saveId}. Cap at one per account per week, unsubscribe honored on the accounts row. The doors journal (shipped this week) makes the hook concrete and story-native rather than generic 'come back!'. Directly attacks D7/D30 with content the engine already wrote.

*Builds on:* lifecycle.ts sweep pattern + turn_history + doors journal (creator arc, shipped) + Resend sender

#### [medium impact / large effort] Light up seasons with the engine that already exists

The pure functions (getActiveSeason, buildAchievementUnlocks, buildLeaderboardEntries, rankLeaderboard) and tables (seasons, leaderboard_entries) are built and tested — what's missing is ~3 Convex functions and a write hook: (1) seasonsFunctions:getActive query joining season + ranked leaderboard; (2) a leaderboard write in game.ts's ending-unlock path (where endings_unlocked inserts happen) when the save's story is the season tale; (3) mint the season row alongside mint-daily-tale or by hand for season one. Replace /seasons' hardcoded leaders array with the live query and add a season strip to the DailyCard ('This tale counts toward First Candle'). Cheapest path: make the Daily Tale itself the season surface so no new content pipeline is needed. Targets D30 + endings-per-account.

*Builds on:* convex/seasons.ts pure engine + schema.ts seasons/leaderboard_entries + game.ts endings-unlock path + DailyCard

#### [medium impact / small effort] Host entry points for co-op: 'Read together' on home and the ending panel

The entire co-op stack works but no one can start a room. Three wires: (1) a 'Read together' row on the home page under Starter adventures that calls createCoopRoomRemote for a chosen story and shows the invite link (coop screen already renders all of this once membership exists); (2) an ending-panel tertiary action 'Read it again, together' that seeds a room from the same story — endings are the natural co-op recruitment moment ('you have to see this'); (3) add Fireside to AppNav. Invitees already work via URL. This converts the co-op session rate metric from structurally-zero to measurable, and each invite link is an acquisition loop (secondary readers need no account, per product.md feature 11).

*Builds on:* coopFunctions.ts + components/coop/CoopRoomScreen + lib/coopApi.ts (all built); index.tsx home + EndingPanel action row

#### [medium impact / small effort] Returning-reader home: flip the hero for anyone with a save

In index.tsx, when library.continueSave exists, demote the Chapter Zero hero below the fold and lead with a 'Your story so far' block: the continue card (last scene title + one-line hook from the save projection), the DailyCard, the librarian-rank chip (librarianRankChipLabel — currently profile-only), and unopened-doors count. First-time guests keep the current acquisition layout untouched. This is pure re-composition of components that already exist and makes every D1+ session open on progress rather than marketing — the same principle the 'Begin again' ending fix (shipped) applied to run ends, applied to sessions.

*Builds on:* index.tsx library.continueSave + DailyCard + storyEngagementW3 rank helpers + DoorsJournal data


---

## Persona: Riley — game systems designer (round 2: next tier of gameplay depth)

**Summary:** The scaffolding shipped this cycle is genuinely strong — the bible registry, promise-keeping, and check pipeline are pure, evented, and testable — but several loops are half-closed: disposition and bondHint are investment sinks with no payoff, the twist bank can never fire, companion check bonuses are structurally unreachable in LLM-driven runs, and co-op discards the margin/unanimity data that would make voting matter. The highest-leverage next tier is closing these loops rather than adding surfaces: bond-derived check bonuses and cast-linked loyalty/betrayal thresholds (small engine patches riding existing events), keepsake-seeded bibles for a real NG+, and a World Seal for cross-tale continuity — all of which reuse the fold/digest/one-shot-directive machinery that already exists and keep spoiler discipline by construction.

### Critiques

#### [HIGH] Companion check bonuses are unreachable in LLM-driven runs — the shipped bond chip is dead weight in the flagship mode

companionVisibleStat requires role==='companion' AND a VISIBLE attribute matching the check's statId (stats.ts:113-119). But the W2 LLM effect union opens exactly spawn/disposition/fact (llm.ts:154-156) — no npc_attribute path — and applyLlmNpcSpawn seeds every spawned NPC with attributes:{} (llm.ts:920-925). So companionBonus is structurally 0 for every LLM-spawned companion; only authored initialNpcs from the Seed-an-Adventure cast editor can ever contribute. The just-shipped companion whisper on CheckChip (apps/app/components/choices/CheckChip.tsx:16) will almost never render in open-premise runs, which is where readers actually build bonds. Weeks of disposition investment (±15/turn, llm.ts:63) buys zero mechanical weight.

*Evidence:* packages/engine/src/stats.ts:113-119; packages/engine/src/llm.ts:154-156, 913-931

#### [HIGH] The twist bank has no consumption loop — twists can never fire, so the digest nags forever

BibleTwist has status pending|fired|retired (bible.ts:103-108), but nothing in the system can ever set 'fired': the scene output schema has no twistFired field (llm.ts has beatFired only), and foldRegistryEvents handles promise/adopt/granted/seeded/door_opened/phantom — no twist case (storyBible.ts:303-352). buildBibleDigest filters status==='pending' (bible.ts:786-789), so once the model actually lands a twist in prose, the prompt keeps demanding the same 'TWISTS held back' every subsequent turn — an engine for repeated reveals of an already-revealed twist. Only an act-boundary refresh can retire one, and only by the model omitting it.

*Evidence:* packages/engine/src/bible.ts:103-108, 786-789; convex/llm/storyBible.ts:303-352

#### [MEDIUM] bondHint is a generated-and-discarded field, and the bible cast never links to actual NPCs

The planner is asked to write bondHint ('how the reader might earn or break their trust', storyBible.ts:108), it survives policy scrub (storyBible.ts:254), and then buildStoryBibleSection deliberately drops it (scene.ts:283-284, 'bondHint stays server-side') — but NPC sheets carry vibe+knownFacts, not bondHint, so nothing ever pays it off. Worse, cast ids and NpcState ids are disjoint namespaces: npc_spawn carries no castId and no slug-matching exists, so a cast member's want/secret keep prompting even after that character died, betrayed, or never appeared, while the NPC sheet for the same character (scene.ts:91-102) describes them with none of that interiority. Two half-systems describing one person.

*Evidence:* convex/llm/storyBible.ts:108, 254; convex/llm/prompts/scene.ts:283-284; packages/engine/src/llm.ts:175-182

#### [MEDIUM] Disposition is a mood ring — nothing mechanical happens at any threshold

The sole consumer of the -100..100 disposition scalar is mapDispositionToVibe's five prose words (scene.ts:35-41). Crossing +75 or hitting -100 does nothing: clampDisposition silently pins (npcs.ts:192-198, llm.ts:953-958), no diff, no event, no state transition (a rival never becomes a companion, an ally never walks). The LLM can move it ±15/turn, the reader sees 'wary'→'warm', and that is the entire payoff arc. Given product.md principle 3 ('every choice should change... an ending'), relationship investment is currently the one resource with no sink and no jackpot.

*Evidence:* convex/llm/prompts/scene.ts:35-41; packages/engine/src/npcs.ts:192-198; .spec-workflow/steering/product.md:72

#### [MEDIUM] Co-op vote resolution flattens all the interesting data to a bare choiceId

resolveCoopVote computes counts, margin, and unanimity, then throws them away — the caller gets {room, choiceId} only (coop.ts:229-254), and resolveTurn just returns it (coopFunctions.ts:151-168). A 4-1 split and a unanimous 5-0 produce identical turns; nothing reaches the prompt, the clock, or the scene. Votes are secret (hasVoted only, lib/projections.ts:24) which is good groundwork, but the tension it creates has no mechanical or narrative echo. Also note voteEndsAt is only stamped on the FIRST cast vote (coop.ts:223), so a room where nobody votes has no timer at all and resolveTurn hard-errors vote_unresolved forever.

*Evidence:* convex/coop.ts:223, 229-254; convex/coopFunctions.ts:151-168; convex/lib/projections.ts:13-26

#### [MEDIUM] Keepsake carry is invisible to the planner — the relic can't gate anything

createSave validates ownership and injects the tagged item (game.ts:394-432), and the scene prompt gets the KEEPSAKE inventory annotation (scene.ts:592-599), but the turn-1 story-bible and arc generation calls are not told a keepsake was carried. The planner can't write a door keyed to the relic, a cast member who recognizes it, or a twist preconditioned on it — so 'the echo of another life' depends on the scene model's per-turn whim, exactly the ambient-drift failure mode the bible spec was built to kill (registry-enforced gates, promise-keeping).

*Evidence:* convex/game.ts:394-432, 3880-3881; convex/llm/prompts/scene.ts:592-599; convex/llm/storyBible.ts:100 (prompt takes no keepsake context)

#### [LOW] Daily premise stride comment is a lie in code, and a 12-entry bank repeats every 12 days

buildDailyPremise's comment claims a co-prime stride so (tone, premise) pairs 'only repeat after toneCount × bankCount days', but the code is a plain `ordinal % bankCount` with no stride (daily.ts:151-153). gcd(14,12)=2, so only half the 168 combinations ever occur and the pair-cycle is 84 days, not 168 — and the premise itself recurs every 12 days regardless. For the retention loop R13 is meant to power ('endings unlocked per active account'), a returning daily player sees 'The Lamp at World's Edge' again within two weeks with only a tone-word changed.

*Evidence:* convex/daily.ts:39-100, 146-157

### Ideas

#### [high impact / small effort] Bond-derived companion bonus: disposition becomes the check math

Replace/augment companionVisibleStat: an NPC with role 'companion' OR 'ally' contributes +1 to checks when disposition ≥ 50 (the existing 'friendly' band, scene.ts:35-41), +2 at ≥ 90; a 'hostile' in-scene rival contributes −1. Pure change inside resolveSkillCheck/resolveChoiceCheck (stats.ts:81-119, 242-297) — no new LLM surface, no schema change, deterministic, and the breakdown already carries companionContributions so the shipped CheckChip whisper ('Mira steadies your hand') lights up immediately in LLM-driven runs. Odds phrases (choiceCheckOdds) pick it up for free. Spoiler discipline unchanged: reader sees the whisper phrase, never the number. This single small patch fixes both the dead bond chip and the mood-ring problem at once.

*Builds on:* stats.ts resolveChoiceCheck/companionVisibleStat + mapDispositionToVibe bands + CheckChip companion phrase

#### [high impact / medium effort] Loyalty/betrayal threshold events riding the bible cast sheet

Link cast to roster: on npc_spawn, slug-match npc.id/name against bible.cast ids/labels (same tolerant matching findRegistryKey uses, bible.ts:617-625) and stamp castId on NpcState. Then add two threshold events to the disposition applier: crossing +75 emits a `bond_crystallized` engine event; crossing −60 emits `bond_broken`. Fold these into the bible as cast.status ('bonded'/'estranged'), and the NEXT turn's prompt gets a one-shot directive in the pursuit block — mirroring the existing 'A THREAD FIRES THIS SCENE' pattern (scene.ts:193-195): 'Mira's trust has crystallized — pay off her bondHint: <bondHint>' or 'Mira's patience broke — her secret (<secret>) now arms against the reader'. bondHint finally gets consumed; the secret becomes a mechanically-triggered betrayal instead of a forever-pending nudge. Spoiler discipline: directives live only in the prompt; the reader sees the scene, plus the existing 'will remember that' echo surface.

*Builds on:* bible cast sheet (bible.ts:95-101) + disposition applier (llm.ts:872-899) + pursuit one-shot directives (scene.ts:144-197) + foldRegistryEvents pattern

#### [medium impact / small effort] Close the twist loop with a beatFired-style twistFired field

Add optional `twistFired: string` to the scene output schema (exact mirror of the existing beatFired contract the arc uses), slug-matched against pending twist ids; emit a `twist_fired` RegistryEvent and add the case to foldRegistryEvents (storyBible.ts:303-352) so status flips to 'fired' in the same mutation. Digest already filters pending, so the nag stops automatically. Add phantom-style telemetry (baseline metric like the shipped phantom-gate 0%): twists still pending at the act-3 refresh get retired by mergeBibleRefresh — which already knows how (bible.ts:904-915). Prompt needs one sentence appended to the TWISTS line: 'when this scene fires a twist, set twistFired to its id'.

*Builds on:* storyArc beatFired plumbing + foldRegistryEvents + buildBibleDigest pending filter

#### [high impact / medium effort] Faction reputation as a hidden-stat convention with a bible-planned faction sheet

Zero new engine state: applyStatDelta already auto-creates hidden attributes on first delta (stats.ts:39-44), so `rep:iron-covenant` works today. Add an optional `factions: 2-3 {id, label, creed ≤120}` section to the bible (validated like cast, bible.ts:250-270), render one digest line, and give arc saves a REPUTATION prompt rule: 'when the reader visibly helps/harms a faction, emit a stat effect on rep:<id> (±1..2); gate faction-interior choices with stat_at_least on it'. The shipped locked-choice UX carries the rest for free — humanized hints and near-miss bands already know how to say 'The Covenant does not yet trust you' without leaking numbers, and endingHints.requires can reference reps. Spoiler discipline: rep attributes stay visibility:hidden and never project; the reader feels standing through NPC vibes and locked doors, matching how disposition already behaves.

*Builds on:* hidden attributes (stats.ts:26-49) + bible section validation + locked-choice near-miss UX + endingHints

#### [high impact / large effort] The World Seal: minimal cross-tale carry that makes a sequel feel earned

At terminal, alongside the keepsake mint (game.ts:4896-4939), persist a compact `worldSeal` on the endings_unlocked row: {endingId+label, up to 5 codex truths (the string-valued flag_set 'Truths the tome recorded' — reader-witnessed by construction), surviving cast members with final disposition band + castId}. createSave grows a `sealId` arg next to keepsakeId (same ownership check as game.ts:397-411). The seal feeds THREE places: (1) a 'PRIOR VOLUME — canon' prompt block above the world anchor; (2) buildStoryBiblePrompt, so the planner can write returning cast entries and a door keyed to the past ('the name you learned in Volume I opens...'); (3) initial flags on the new save so the engine, not just the prose, remembers. This is exactly product.md's 'tome that remembers across volumes' with no new tables and no spoiler risk — every seal field was already shown on screen in the prior run.

*Builds on:* keepsake carry pipeline (game.ts createSave + recordEndingUnlock) + codex flag_set rule (scene.ts CODEX R11.3) + bible generation prompt

#### [medium impact / medium effort] Vote tension with teeth: margin feeds the doom clock, unanimity feeds the next check

resolveCoopVote already computes everything needed — return {choiceId, votesFor, votesTotal, unanimous} (coop.ts:236-244). Thread a voteContext into the coop submit path: a split decision (<2/3 majority) applies applyClockAdvance(+1) via the existing clock plumbing ('the fellowship argues; the candle burns'), unanimity sets a one-turn flag granting +1 to the next skill check (a third additive term next to itemBonus in resolveChoiceCheck, stats.ts:257-258). One prompt line in the pursuit block: 'The readers were divided over this choice — let the discord show' / 'The readers chose as one'. Secret ballots (hasVoted-only projection) already create the social tension; this makes the reveal matter. Also fix the stall: stamp voteEndsAt when the scene renders in vote mode, not on first vote, and let a cron or the read query auto-resolve expired timers.

*Builds on:* resolveCoopVote (coop.ts) + StoryClock applyClockAdvance (arc.ts) + resolveChoiceCheck bonus terms (stats.ts)

#### [medium impact / medium effort] Hardcore-exclusive endings and ember keepsakes — give permadeath a jackpot, not just a guillotine

Hardcore currently only subtracts (clock −25%, checks +1 band, purge on death). endings_unlocked rows already record mode (endings.ts:8, endingsFunctions.ts:48) — product.md feature 6 even presumes 'hardcore-only ending unlocks' exist. Two additions: (1) at hardcore terminals, candidate endings gain a hardcore-variant trophy label ('...by candlelight') rendered in the crypt — pure projection off the stored mode, zero engine work; (2) hardcore success mints an 'ember' keepsake (a keepsake with a mechanical tag): when carried into any future run it grants a once-per-run auto-partial on a failed desperate check ('the ember flares'). Implemented as a tag check inside outcomeCost/resolveChoiceCheck plus a consume flag — the first keepsake with weight, and a reason to survive hardcore rather than merely attempt it. Spoiler-safe: the ember's power is stated on its description at mint time.

*Builds on:* endings mode field + keepsake mint (game.ts resolveEndingKeepsake) + resolveChoiceCheck outcome table

#### [medium impact / small effort] Deterministic mutator rotation on the Daily — seasonal spice with the exact same purity discipline

Extend daily.ts's proven table pattern (DAILY_TONE_ROTATION, daily.ts:16-31) with a MUTATOR_ROTATION: entries like {id:'short-candle', label:'The candle is short tonight', engine:{clockMax:6}}, {id:'empty-pockets', engine:{startCurrency:0}}, {id:'cruel-odds', engine:{checkBand:+1}}, {id:'crowded-tale', engine:{rosterCap:3}} — every knob already exists as a pure lever (createClock opts, bumpDifficulty stats.ts:209-213, NPC_ROSTER_CAP). buildDailyPremise returns the mutator with premise+tone (co-prime stride this time, and while there, fix the missing stride and grow the 12-entry bank); the Daily card shows the mutator label so the global distribution screen (computeDistribution) becomes a same-handicap comparison — 'only 4% escaped under the short candle'. One optional prompt line carries the fiction. All-ages, deterministic, unit-testable exactly like the existing module demands (BC6 header, daily.ts:4-8).

*Builds on:* daily.ts pure rotation tables + engine mode knobs (createClock hardcore opts, bumpDifficulty) + daily results distribution

#### [high impact / small effort] Keepsake-seeded bible: the carried relic becomes a registry key with a planned late door

When a save carries a keepsake, inject it into the bible at attach time: add it to keyRegistry as a pre-granted key ({id: keepsake.id, label, opensHint: keepsake.description, status:'granted'}) — attach-time seeding in the same code that runs matchEndingHints — and pass the keepsake into buildStoryBiblePrompt with one instruction: 'the reader arrives carrying <label> (<description>); plan at least one lockPlan door keyed to it, gateBand late'. validateProposedBible already enforces the door→key reference (bible.ts:234-238), processGatedChoices already passes has_item on held items, and the re-offer machinery makes the model actually stage the door. Result: NG+ stops being flavor-text and becomes a guaranteed 'your other life opens a door this one couldn't' beat — the single cheapest way to make replays-with-carry structurally different, which is the moat product.md names (endings + switching cost).

*Builds on:* keepsake carry (game.ts:394-432) + bible attach/matchEndingHints + lockPlan validation + registry gate enforcement (processGatedChoices)


---

## Persona: Theo — AI film director / art director; brief: story-tightness of generated image+video and visual consistency of protagonist, setting, and palette from scene 3 through the ending cinematic

**Summary:** The anchor carry-over pipeline is genuinely good bones — turn-1 protagonist/setting anchors threaded as Gemini Flash Image references, portraits style-matched to the protagonist, and a salience-ranked reference set feeding Omni cinematics. But the production has no written art direction: style exists only as pixels, so every fallback path (Imagen 4, text-only Veo, the Omni prompt itself) drops the look entirely; anchors are a turn-1 single shot with no retry; scene renders and NPC portraits never cross-reference, so the same companion has two faces; and the ending cinematic is a montage that doesn't know which ending it concludes while the purpose-built motifs field sits unread. The fixes are unusually cheap because the infrastructure already exists — a visualBible block on the existing story-bible call, two idle reference slots, an already-detected act_advanced hook for pre-warm, and the phantom-gate telemetry pattern ready to clone for drift measurement.

### Critiques

#### [HIGH] Art direction exists only as pixels — there is no textual style state anywhere

The run's entire visual identity is decided implicitly by whatever the scene LLM writes into the turn-1 anchor sentences, and from then on style is carried ONLY as reference bytes. Every path that loses the references loses the whole art direction: the Imagen 4 fallback is prompt-only with no references (sceneMedia.ts:327 `maybeRunImagen(args.prompt)`), the text-only Veo path has no style language at all, and the Omni cinematic prompt is pure narrative (cinematics.ts:846 `prompt: args.beatTimeline` — not one word of palette, era, or style). One Gemini hiccup mid-run means scene 9 ships in a completely different style than scenes 1-8, and the ending cinematic's look is whatever Omni infers from 6 thumbnails. Worse, the style itself is example-contaminated: the anchor instruction bakes 'painterly realism' into BOTH few-shot examples (prompts/scene.ts:516), so a neon cyberpunk premise routinely inherits a painterly look — the exact drift class the prose side already fixed with premise-affinity rules (scene.ts:393), never applied to the camera.

*Evidence:* convex/media/sceneMedia.ts:326-327, convex/media/cinematics.ts:846-847, convex/llm/prompts/scene.ts:516 and :393

#### [HIGH] Anchors are a turn-1-only single shot with zero retry — one failed call silently un-anchors the entire run

queueAnchorImage is invoked only when `save.turnNumber === 0` (game.ts:2101). If runAnchorImageJob fails (empty Gemini response, transient 500), it marks the asset failed and never reschedules (sceneMedia.ts:1396-1404). The failure cascades everywhere: every scene renders reference-less for the rest of the run (sceneMedia.ts:199-214 'silently drops missing ones'), NPC portraits ship in 'default Gemini style' forever (npcMedia.ts:287-291), and the cinematic reference set loses both anchors (cinematics.ts:383 skips non-ready). The cruel irony: the pointer-unset state is already retry-safe — queueAnchorImage's idempotency checks the save pointer, not the failed row (sceneMedia.ts:1318-1324) — but nothing ever calls it again. The anchor-settle retry loop pattern exists 30 lines away for the opening cinematic (cinematics.ts:99-104, 646-665) and was never applied to the anchors it waits on.

*Evidence:* convex/game.ts:2101, convex/media/sceneMedia.ts:1396-1404 and 1318-1324, convex/media/npcMedia.ts:287-291

#### [HIGH] Same character, two faces: NPC portraits and scene renders never cross-reference each other

Scene images condition on exactly two references — loadReferenceBytes hard-codes `[ids.protagonist, ids.setting]` (sceneMedia.ts:1234) — so a companion who has a canonical roster portrait (conditioned on the protagonist anchor for style, npcMedia.ts:294-303) is re-invented from scratch in every scene render, described only by whatever the visualDescription happens to mention. The scene schema already captures `npcMentions` (prompts/scene.ts:451) and MAX_REFERENCE_IMAGES is 4 with two slots permanently unused (geminiImageClient.ts:30) — the plumbing to fix this is sitting idle. Compounding it, portrait idempotency is one-shot (npcMedia.ts:206-212): if an NPC spawns on turn 1-2 before the protagonist anchor lands, its style-less portrait is frozen for the whole save, so even the roster grid itself is internally inconsistent.

*Evidence:* convex/media/sceneMedia.ts:1234, convex/media/npcMedia.ts:206-212 and 287-303, convex/media/geminiImageClient.ts:30, convex/llm/prompts/scene.ts:451

#### [MEDIUM] The ending cinematic does not know which ending it concludes

endingId reaches the asset only as tags/provenance metadata (cinematics.ts:730, 740, 752); the actual Omni prompt — buildBeatTimeline (cinematics.ts:151-250) — is storySummary + choiceLabels + last-scene prose. No ending label, no hint, and no tonal differentiation: a death, a triumph, and a safety exit get byte-identical framing. The engine's CandidateEnding carries a `hint` (packages/engine/src/types.ts:228-232) and the bible carries `endingHints` (storyBible.ts:110), both already policy-sanitized — neither is read. And when the safety classifier blocks the spine, the finale degrades to the maximally generic 'A cinematic montage of the tale X' (cinematics.ts:209-249) at the single most emotionally loaded moment of the product ('story first', product.md).

*Evidence:* convex/media/cinematics.ts:151-250 and 730-752, packages/engine/src/types.ts:228-232, convex/llm/storyBible.ts:110

#### [MEDIUM] bible.motifs is a dead field end-to-end — the one field designed as the visual anchor is the one field nobody reads

Motifs are prompted for (storyBible.ts:111 'imagery and tone anchors'), validated (engine bible.ts:307-318), policy-sanitized (storyBible.ts:265-267), and persisted (schema.ts:485 comment names them). Consumption: zero. They are absent from BibleDigest (engine bible.ts:723-730), absent from every prompt builder in convex/llm/prompts, and grep-clean across convex/media/ and the game.ts media paths. This was reserved as the cinematic pre-warm hook and the pipeline that needs it most — beatTimeline, anchor prompts, the safety-blocked neutral fallback — pays the LLM to generate it every run and then discards it.

*Evidence:* convex/llm/storyBible.ts:111 and 265-267, packages/engine/src/bible.ts:307-318 and 723-730, convex/schema.ts:483-490; no references under convex/media/

#### [MEDIUM] The reference wrapper fights dramatic lighting, and there is no shot grammar at all

geminiImageClient.ts:83-86 commands 'Match the lighting and art style of the references' — but the setting anchor is an establishing shot whose example is literally 'cove at dawn' (scene.ts:516), so a midnight climax gets dragged toward dawn light on every render. Meanwhile composition is delegated entirely to the per-scene LLM's visualDescription whim (scene.ts:473 asks for 'close-up, wide shot, over-the-shoulder, etc.' with no guidance on WHICH), despite the save carrying a full arc state — act, beat kind, terminal proximity (StoryArc in engine types.ts) — that a director would use: inciting = establishing wide, dark-night = close low-key, climax = high-contrast close-up echoing the candidateEnding. The identity instruction ('same face, same wardrobe') is right; the lighting clause should yield to the scene.

*Evidence:* convex/media/geminiImageClient.ts:83-86, convex/llm/prompts/scene.ts:473 and 516, packages/engine/src/types.ts:236-248

#### [LOW] Ending payoff is late and beat-starved: no pre-warm, and companions crowd beats down to one slot

The ending cinematic is queued only after the terminal write (game.ts:2032/4528) and Omni polls up to 5 minutes (cinematics.ts:67-71 OMNI_MAX_POLLS=50 × 6s), so the reader stares at a poster still at the exact payoff moment — despite endingHints existing from turn 0 that could seed a pre-warm. Separately, the salience order protagonist → setting → ≤3 companions → beats under cap 6 (cinematics.ts:79-81, 334-348) means any run with 3 portrait-bearing companions gets exactly ONE beat still into the 'movie of your playthrough' — the montage becomes a cast lineup, not a journey.

*Evidence:* convex/media/cinematics.ts:67-71, 79-81, 334-348; convex/game.ts:4960-4978

#### [LOW] No continuity QA and no drift telemetry — markReady is the only gate between the provider and the reader

A render where Gemini ignored the references (a known multi-image conditioning failure mode) goes straight to markReady (sceneMedia.ts:349-354) and onto the MediaPlate. There is no check, no retry, and — more importantly for this codebase's own discipline — no measurement: the story-bible spec just established the telemetry-first pattern (phantom-gate rate, baseline 0%) for narrative consistency, and visual consistency has no analog metric. You cannot tune what you cannot see; today nobody knows the actual drift rate of the anchor carry-over pipeline.

*Evidence:* convex/media/sceneMedia.ts:349-354; .spec-workflow/specs/story-bible (phantom-gate telemetry precedent)

### Ideas

#### [high impact / small effort] VISUAL BIBLE: one art-direction block, generated by the existing story-bible call, injected into every media prompt

Extend buildStoryBiblePrompt (storyBible.ts:93-121) with a `visualBible` field: { style: ≤60 chars ('desaturated 70mm photorealism'), palette: 3-5 named colors, eraCostume: one line, lightingGrammar: one line, negatives: ['no candles', ...] } — the LLM already plans the world's nouns here; asking it to also lock the look is the same call. Validate in engine validateProposedBible alongside motifs, persist on story_bibles, sanitize via the existing policySafe pass. Injection points: prepend 'Art direction: {style}; palette {palette}; {eraCostume}' to (a) both anchor prompts at game.ts:2104-2125, (b) the scene visualPrompt at game.ts:2252 before queueSceneImage, (c) the portrait prompt at npcMedia.ts:294, (d) the beatTimeline preamble in queueEndpointCinematic (cinematics.ts:693), (e) the Veo prompt. This makes style survive every reference-loss fallback — the Imagen 4 path, text-only Veo, and Omni all restate the look in words. Cost delta: ~150 extra output tokens on an already-scheduled background call, <$0.001/run, zero new calls. Failure tolerance (BC5): field absent (bible failed, authored story, legacy save) → every prompt is byte-identical to today, mirroring the R3.5/BC9 bible-less discipline that already exists.

*Builds on:* convex/llm/storyBible.ts generateStoryBible + the story-bible spec's sanitize/persist pipeline

#### [high impact / medium effort] Character sheets: canonical descriptors locked at anchor time + NPC portraits as scene-render references

Two halves. (a) TEXT: persist the turn-1 protagonistAnchor/settingAnchor sentences on the save (they are currently used once at game.ts:2102-2103 and discarded) and each NPC's buildPortraitPrompt output on the NPC state at queue time (npcMedia.ts:214). When the scene's npcMentions (already parsed in llmSceneOutputSchema) names a rostered NPC, append '{name}: {descriptor}' verbatim to the visual prompt — same-words-every-time is how you get same-face-every-time. (b) PIXELS: generalize loadReferenceBytes (sceneMedia.ts:1226, currently hard-coded to protagonist+setting) and the referenceAssetIds validator to carry up to 2 portraitAssetIds resolved from save.state.npcs for mentioned NPCs, filling the two spare MAX_REFERENCE_IMAGES=4 slots (geminiImageClient.ts:30). Update the guided wrapper to name each reference's role. Cost delta: zero extra API calls — portrait bytes are already in Convex storage; ~1-2 MB extra request payload on companion scenes only. Failure tolerance: un-ready portrait → skipped exactly like un-ready anchors today; descriptor missing → prompt unchanged.

*Builds on:* sceneMedia.ts anchor reference carry-over + npcMedia.ts portrait pipeline + llmSceneOutputSchema.npcMentions

#### [high impact / small effort] Anchor retry: reschedule on failure, opportunistic re-anchor on turns 2-3

On runAnchorImageJob failure (sceneMedia.ts:1396-1404), schedule `queueAnchorImage` again via ctx.scheduler.runAfter(30_000, ...) with an attempt counter capped at 2 — the exact bounded-reschedule pattern already proven by the opening cinematic's anchor-settle loop (cinematics.ts:99-104, OPENING_ANCHOR_RETRY_MS/MAX_ATTEMPTS). The idempotency pointer check (sceneMedia.ts:1318-1324) already makes this safe. Belt-and-braces: in completeSceneStream on turns 2-3, if a pointer is still unset and the anchor text was persisted (idea 2a), re-queue once. Requires threading the prompt through (persist it on the failed asset's provenance, or read from the save per 2a). Cost delta: ~$0.04 per retry, paid only on provider failure. Failure tolerance: retries exhausted → today's reference-less behavior; the run degrades exactly as it does now, just far less often.

*Builds on:* sceneMedia.ts queueAnchorImage idempotency + cinematics.ts anchor-settle reschedule pattern

#### [medium impact / small effort] Beat-aware shot grammar derived from the arc state the save already carries

A pure function `shotGrammarForBeat(arc, terminal): string` in convex/media (unit-tested like buildPortraitPrompt) mapping act + current ArcBeat kind → a camera/lighting clause: establish → 'wide establishing shot, full environment'; escalation → 'medium shot, tightening frame'; dark-night/low-stat → 'close-up, low-key single-source lighting'; climax → 'high-contrast close-up' seasoned with the matching candidateEnding.hint (engine types.ts:228). Append it to visualPrompt at game.ts:2252 and to the beatTimeline for chapter/ending cinematics. Simultaneously fix the wrapper conflict: change geminiImageClient.ts:85-86 to 'Match the art style and character identity of the references; lighting and time-of-day should follow the scene description' so a night climax stops being dragged toward the anchor's dawn. Cost delta: zero — string concatenation. Failure tolerance: arc-less legacy save → no clause, prompt unchanged.

*Builds on:* packages/engine/src StoryArc/ArcBeat state + game.ts visualPrompt assembly + geminiImageClient guided wrapper

#### [medium impact / small effort] Ending-aware beatTimeline: name the ending, set the tone, keep motifs in the safety fallback

Pass endingId + terminal kind into buildBeatTimeline — queueEndpointCinematic already has both in hand (cinematics.ts:693-700) and drops them. Resolve the label+hint from the arc's candidateEndings (save.state) or the bible's endingHints, and close the spine with 'The tale ends: {label}. {hint}.' plus a per-kind tonal directive (death → elegiac, slow push-in; success → triumphant, rising light; safe → quiet, dawn). Also upgrade the safety-blocked neutral fallback (cinematics.ts:209-249): motifs are short, already policy-classified strings (storyBible.ts:265-267) — 'A cinematic montage of {title}: {motifs.join(', ')}' keeps even the scrubbed finale on-theme instead of maximally generic. This is also the cheapest possible resurrection of the dead motifs field. Cost delta: zero new calls; +~80 prompt chars. Failure tolerance: missing arc/bible/strings → today's spine verbatim.

*Builds on:* cinematics.ts buildBeatTimeline + engine candidateEndings + storyBible endingHints/motifs

#### [medium impact / medium effort] Ending cinematic pre-warm: act-3 poster stills per bible endingHint, matched at terminal time

On act-3 entry — the act_advanced diff is already detected at game.ts:2150 for the chapter stinger — schedule one Gemini Flash Image still per bible endingHint (≤4 images), prompted from {visualBible} + {endingHint.requires} + protagonist anchor reference, stored as assets tagged `ending-poster:{endingId}`. At terminal time, resolvePosterStillUrl (cinematics.ts:704) prefers the matching poster over the generic last-scene still, so CinematicMoment opens INSTANTLY on an on-theme, on-style frame while the 1-5 min Omni render proceeds behind it — the payoff moment stops being a loading state. Optional aggressive tier: speculatively submit the full Omni job for the single most-probable ending; the (saveId,'ending',endingId) dedupe (cinematicAlreadyExists) already makes the real trigger a no-op on a hit. Cost delta: ~$0.15/run in posters (Pro-only, act-3 runs only); speculative clip +$0.80 at whatever hit rate telemetry shows. Failure tolerance: unmatched endingId → today's poster fallback; orphaned posters swept by mediaCleanup.ts.

*Builds on:* game.ts act_advanced detection + cinematics.ts resolvePosterStillUrl/dedupe + story-bible endingHints

#### [medium impact / small effort] Continuity QA, telemetry-first: measure drift against the anchor before tuning anything

Phase 1 (measure only, exactly the phantom-gate playbook): in runImagenJob between the live result and markReady (sceneMedia.ts:329-354), when a protagonist reference was passed, fire one gemini-flash-lite vision call with [anchor, new render]: 'Same person? Same art style? JSON {samePerson, sameStyle, confidence}'. Log a `media.drift` analytics event (analytics plumbing already imported by cinematics.ts) with the verdict + refCount + model — establishing the actual drift rate of the carry-over pipeline, currently unknown. Phase 2, only if the baseline warrants: one retry with a reinforced wrapper on a confident samePerson=false, then serve regardless. Never block, never fail the job — the check runs after the image is already viable. Cost delta: ~$0.0003/scene for the check (flash-lite, 2 low-res images); retries ~$0.04 × measured drift rate. Failure tolerance: QA call errors → serve unchecked and log nothing; markReady is untouched (text is the contract).

*Builds on:* sceneMedia.ts runImagenJob + analytics_events + the story-bible spec's phantom-gate telemetry precedent


---

## Persona: Iris — product designer for monetized media controls, briefed to design "spend XX credits to animate this part of the story vs always doing so"

**Summary:** The bones for a credit economy are already in this codebase — entitlements carry includedImages/includedVideos/creditBalanceCents, a usage_meters table exists, media assets have queued/generating/ready/failed lifecycles, and cinematic triggers are pure and queue-gated — but every metering primitive is dead code: nothing ever writes usage_meters, decrements an allowance, or reads creditBalanceCents, so today "Pro" means unmetered video. That is actually good news for the founder's ask: the control surface (Illuminate-this-page, budget modes, creator-funded beats) can be built by wiring spend into the existing queue mutations and failed-state handlers rather than inventing new machinery. The main design risks are the demo-grade paywall route, an inverted video-vs-image overage price, and a settings selector that silently does nothing for free readers — the opposite of the in-fiction, honest upsell product.md demands.

### Critiques

#### [HIGH] The entire metering/ledger layer is dead code — Pro video is unmetered today

applyUsageDelta, calculateOverageCents, and enableOverage have zero non-test callers; the usage_meters table is only ever deleted (account purge paths), never written; the Pro allowance of 100 images / 20 videos (entitlements.ts:51-56) is never decremented at any queue site — queueSceneImage/queueSceneVideo/queueEndpointCinematic gate only on tier==="pro" && status==="active"; and creditBalanceCents is only ever initialized to 0. A Pro reader can generate unbounded Veo/Omni renders per month with no cap, and any credits feature must first wire this layer in or it will be a UI painted over nothing.

*Evidence:* convex/billing/paywall.ts:25-72 (no callers outside tests — grep applyUsageDelta/enableOverage); convex/schema.ts:76-90; convex/accountFunctions.ts:181 and convex/lifecycle.ts:127 (only deletes); convex/billing/entitlements.ts:42,51-56; convex/media/imagen.ts:93; convex/media/cinematics.ts:615-622

#### [HIGH] Overage pricing is inverted: a video costs less than an image

calculateOverageCents charges imageOver * 25 + videoOver * 20 cents — video overage priced BELOW a still, when a Veo clip's provider cost is roughly an order of magnitude above an Imagen render. If credit costs are derived from these constants (the only per-unit media prices in the repo), every reader-directed animation loses money. The credit price card must be rebuilt from real per-provider unit economics, which the operator dashboard already wants ('AI cost per session, per provider').

*Evidence:* convex/billing/paywall.ts:57; .spec-workflow/steering/product.md:82 (operator dashboard: AI cost per session per provider)

#### [MEDIUM] The paywall route is a design-review demo with a 'credits' reason that leads nowhere

apps/app/app/paywall/index.tsx lets the reader flip the paywall reason via a segmented selector ('so design wave 0 review can flip through all variants'), and PaywallReason already includes "credits" — but no purchase flow exists behind it: createCheckoutSession only accepts subscription paidTier ('unlimited'|'pro') with recurring prices, so there is no one-time Stripe payment path for à la carte credit packs. A credit economy has no landing surface and no checkout primitive today.

*Evidence:* apps/app/app/paywall/index.tsx:25-27,52,180-212; apps/app/components/paywall/types.ts:3; convex/billingFunctions.ts:27-48; convex/billing/config.ts:8-17 (subscription price env keys only)

#### [MEDIUM] Free readers get a dead four-way 'Cinematic mode' control instead of an upsell moment

The /settings selector shows Off / Stills only / Endpoint cinematics / Per-scene to every account, but for non-Pro readers endpoint_cinematic silently degrades to per_scene_legacy (mediaStrategy.ts:69) and the per-scene queue sites then hard-require tier==="pro" anyway (imagen.ts:93) — so the entire control is a no-op for free/Unlimited, hedged only by 'your plan may cap the effective setting'. This is dishonest control surface AND a wasted conversion moment: product.md explicitly wants Pro conversion via in-context illustration/video upsells, and the raw settings selector breaks the living-book fiction the brand rests on.

*Evidence:* apps/app/app/settings/index.tsx:225-243; convex/media/mediaStrategy.ts:66-72; convex/media/imagen.ts:93; .spec-workflow/steering/product.md:51,70

#### [MEDIUM] No consent-per-render or spend-preview step exists anywhere in the media pipeline

Cinematics auto-fire from server triggers inside the turn loop (queueEndpointCinematic scheduled at ending/opening/chapter sites) with no 'ask me first' mode in the cinematicMode union and no reservation/confirm state in the asset lifecycle (queued→generating→ready/failed only). For a spend-credits model, an 'ask me' budget mode and a pre-commit preview (the existing still) are table stakes; today there is no seam for either, and the failed state (markFailed / _markCinematicFailed) has no compensation concept to hang a refund on.

*Evidence:* convex/schema.ts:41-48 (cinematicMode union has no ask_me); convex/media/cinematics.ts:590-628; convex/media/sceneMedia.ts:965-975; convex/schema.ts:560 (asset status union)

#### [LOW] Mid-tale drawer cannot change cinematic behavior despite claiming media prefs sync

ReaderSettingsDrawer's syncMediaPrefs only sends imagesEnabled/audioEnabled/videoEnabled — cinematicMode is omitted — so the one surface the reader has WHILE reading (where an animation-budget decision is actually felt) cannot adjust cinematic mode; they must leave the book for /settings, violating the 'story first' principle for exactly the moments a budget control matters.

*Evidence:* apps/app/components/reading/ReaderSettingsDrawer.tsx:62-73 vs. apps/app/app/settings/index.tsx:225-243; .spec-workflow/steering/product.md:70

### Ideas

#### [high impact / large effort] "Illuminate this page" — reader-directed render with a free still preview

Add a small gilt-initial/candle affordance to the reading layouts (Book/Mobile/ModernApp/Journal/GraphicNovel already mount scene media via getSceneMedia, sceneMedia.ts:1097). Tap opens a fiction-styled sheet: the scene's existing still (image asset, or a queued placeholder) as the ALWAYS-FREE preview, plus 'Ask the scribes to set this page alight — 8 sparks' with balance shown as a candle count. Confirming calls a new public mutation media/illuminate.ts:requestIllumination that (1) debits the ledger idempotently keyed (accountId, saveId, sceneId, kind) so double-taps are safe, (2) invokes the existing queueSceneVideo / queueEndpointCinematic internals with source:"reader_directed" bypassing the strategy gate but not safety gates (assertProMediaAllowed), (3) on markFailed/_markCinematicFailed inserts a compensating refund row. Copy stays in-manuscript: 'This page has been illuminated' on ready, 'The pigment would not take — your sparks return' on refund.

*Builds on:* sceneMedia.ts queue mutations + asset failed states, cinematics.ts queueEndpointCinematic, reading layout components, assertProMediaAllowed safety gate

#### [high impact / medium effort] Auto-cinematic budget modes riding the existing trigger machinery

Extend the cinematicMode union (schema.ts:41-48, accountFunctions.ts:263 validator, useReaderSettings client type) with budget semantics: endings_only / key_beats / every_chapter / ask_me. computeMediaStrategy (mediaStrategy.ts:48) stays pure and gains a budget output; queueEndpointCinematic checks it next to the strategy gate (cinematics.ts:610): endings_only skips the chapter trigger, every_chapter keeps CHAPTER_CINEMATIC_TURNS + MAX_CHAPTER_CINEMATICS_PER_RUN as the hard cap, ask_me writes the asset in a new 'proposed' status that the client renders as the Illuminate sheet pre-armed at the trigger moment ('An ending approaches — shall the scribes film it?'). No new trigger detection needed — cinematicTriggers.ts predicates are untouched.

*Builds on:* cinematicTriggers.ts pure predicates, mediaStrategy.ts computeMediaStrategy, queueEndpointCinematic dedupe/cap logic, settings + ReaderSettingsDrawer prefs sync

#### [high impact / medium effort] media_credits ledger table with idempotent spend and refund-on-failed

New table media_credits_ledger: accountId, delta (+/-), reason ('pro_allowance'|'pack_purchase'|'reader_spend'|'creator_spend'|'refund'), idempotencyKey (unique index — reuse the stripe_webhook_events dedupe pattern, billingFunctions.ts:105-125), assetId?, stripeSessionId?, createdAt. Balance = indexed sum, mirrored into the already-existing-but-unused entitlement.creditBalanceCents for cheap reads. Monthly Pro grant materializes includedImages/includedVideos (entitlements.ts:51-56) into ledger rows on the invoice-renewal webhook in applyStripeWebhook. Spend happens INSIDE the queue mutation (Convex mutations are transactional, so debit+insert-asset is atomic); refund rows are written by markFailed (sceneMedia.ts:965) and _markCinematicFailed (cinematics.ts:1102) keyed by assetId so retries can't double-refund. This finally gives the dead usage_meters/overage layer a working replacement.

*Builds on:* entitlements table + applyStripeWebhook, stripe_webhook_events idempotency pattern, asset failed-state mutations

#### [medium impact / medium effort] À la carte spark packs via one-time Stripe checkout

Add createCreditPackCheckout to billingFunctions.ts using mode:'payment' (the existing createCheckoutSession is subscription-only) with pack SKUs in billing/config.ts env keys (STRIPE_PRICE_SPARKS_SMALL/LARGE); the checkout.session.completed webhook branch in billing/webhook.ts normalizes pack metadata into a 'pack_purchase' ledger row keyed by session id. Client: the dormant 'credits' PaywallReason (components/paywall/types.ts:3) becomes real — the PaywallPanel credits variant sells packs in-fiction ('A pouch of sparks — 50 illuminations') and the Illuminate sheet deep-links there when balance is short, never blocking the underlying text ('The page reads on, unlit'). Native platforms show the same StoreKit-deferred preview the tier board already uses (paywall/index.tsx:70-75).

*Builds on:* billingFunctions.ts createCheckoutSession + webhook pipeline, PaywallPanel variants and PaywallReason 'credits'

#### [medium impact / small effort] MEDIA_CREDIT_COSTS price card derived from real provider economics

Replace the inverted constants in calculateOverageCents (paywall.ts:57, image 25¢ > video 20¢) with a single exported MEDIA_CREDIT_COSTS map in convex/billing/ priced per job kind: imagen still 1 spark, narration chunk 1, Veo i2v clip 8, Omni endpoint cinematic 12 — sourced from the per-provider cost knobs the media clients already isolate (imagenClient/veo/omniClient model constants). One map feeds the Illuminate sheet price labels, the ledger debit amounts, AND the operator dashboard's AI-cost-per-session line (analytics.ts already aggregates imageGenerations/videoGenerations, so add estimated sparks alongside). Keeping it server-exported means client copy can never drift from what is actually charged.

*Builds on:* billing/paywall.ts cost constants, analytics.ts media aggregation, media client model constants

#### [high impact / large effort] Creator-funded cinematic beats on authored seeds — render once, amortize across all readers

authored_seeds (schema.ts:346) gains cinematicBeats: array of {beatHint, trigger:'opening'|'ending'|'scene', kind:'still'|'cinematic'}. The creator dashboard (creatorDashboard.ts — which already computes quit-points per Req 22.5) shows quit-point heat next to a 'This beat deserves a cinematic' marker, so creators spend THEIR sparks exactly where readers leave. Publishing pre-renders via the same queue internals but stores the asset taleId-scoped (assets already carry optional taleId, schema.ts:528) so EVERY reader of the seed gets the cinematic free — including free-tier readers, which is the cleanest possible 'pay for joy' story: the creator's spend enriches the free experience and raises seed play-time, the exact revenue-share input signal creatorDashboard.ts:68 attributes. Marginal cost inverts from per-reader to per-seed.

*Builds on:* authored_seeds + creator dashboard quit-point analytics, taleId-scoped assets table, revenue-share play-time attribution

#### [high impact / small effort] Phantom-cinematic ghost on the ending panel as the honest upsell

When a non-Pro reader's ending trigger fires and queueEndpointCinematic bails with reason 'pro_entitlement_required' (cinematics.ts:621), emit a telemetry event (the story-bible phantom-gate pattern shipped this week) and record a lightweight 'unwritten cinematic' marker on the save. The ending panel — which already mounts WhatMightHaveBeen ghosts — shows a dimmed poster frame built from the scene still (resolvePosterStillUrl already exists, cinematics.ts:704): 'This ending had a moving illumination. It remains unwritten.' Tapping routes to /paywall with reason 'pro_media', replacing today's dead settings selector as the conversion moment and directly serving the Paid→Pro metric. Guardrail-clean: the ghost appears AFTER the ending resolves, so no progression ever gates on it.

*Builds on:* queueEndpointCinematic denial reasons + phantom-gate telemetry pattern, ending panel / WhatMightHaveBeen mount, resolvePosterStillUrl

#### [medium impact / small effort] Codified guardrails: spend is cosmetic-only, enforced not promised

A pure assertSpendIsCosmetic invariant module in packages/engine or convex/lib: (1) the game.ts turn loop and choice gating may never import the credits ledger — enforce with a lint rule alongside the new dead-key linter in packages/stories; (2) reader-directed spend can only ATTACH media to a scene that already resolved (requestIllumination takes an existing sceneId, never influences generation of prose or choices); (3) the free still/text path never checks balance — mirroring how dailyAllowance fails closed but floors at FREE_DAILY_TURNS (entitlements.ts:97-115). This turns product.md principles 7-8 from prose into tests, so no future feature accidentally paywalls progression.

*Builds on:* packages/stories dead-key linter pattern, entitlements.ts fail-closed/floor discipline, product.md principles 7-8


---

## Synthesis (principal-engineer verification + ranking)

### Verified critiques

### Ranked ideas

#### [quick-win] Server-side restartRun: copy seed identity from the ended save — Dana

Verified feasible: the save row already persists seedPremise/seedTitle/seedTone/seedNpcs (game.ts:375 stores, :1639/:1930 read back). A read-copy-insert mutation taking {saveId} eliminates the client starterStories title lookup that makes Begin again throw for authored_seed:* and open-canvas runs. Fixes the top CONFIRMED critique in one mutation plus one call-site change. Highest impact/effort ratio on the list.

*Key files:* convex/game.ts (createSave args 207-218, seed persistence :375, readback :1639/:1930), apps/app/components/reading/ReaderScreen.tsx:344-368, apps/app/hooks/useLibrary.ts:116-123

#### [quick-win] Bond-derived companion bonus: disposition bands become check math — Riley

Verified: companionVisibleStat is the sole gate and the breakdown already carries companionContributions, so the shipped CheckChip whisper lights up the moment disposition>=50 companions/allies contribute +1 (+2 at 90, -1 hostile rival). Pure deterministic engine change, no LLM surface, no schema. Simultaneously fixes the dead-bond-chip critique and gives disposition its first mechanical teeth. Ship with the odds-phrase pickup for free.

*Key files:* packages/engine/src/stats.ts:81-119 (companionContributions plumbing exists), packages/engine/src/llm.ts (spawn seeds attributes:{}), apps/app/components/choices/CheckChip.tsx

#### [quick-win] Turn-3 'bind this tale to your name' soft-signup ribbon — Maya

All ingredients verified present: claimWithEmail is fully built (currently called only from /account), turn count is in the reader projection, and the first-lock coach gives an exact dismissal-persistence pattern to copy. Creates the product.md guest→account metric that currently cannot exist. Inline claim keeps the reader in flow per Principle 5. Vanishing-ink framing is honest — guests really are purged at 7 days.

*Key files:* apps/app/components/reading/ReaderScreen.tsx (turnNumber in projection), apps/app/hooks/useAccountProfile.ts (claimWithEmail), apps/app/components/choices/lockCoach.ts (LOCK_COACH_SEEN_KEY localStorage dismissal pattern), convex/crons.ts (guest purge makes the copy true)

#### [worth-a-spec] Candle truth workstream: real turns API + gutter interstitial + de-demo the paywall (merged) — Maya (two proposals merged; also resolves the paywall-demo critique)

Three proposals share one dependency: a server projection of daily_turn_counter state ({turnsUsedToday, allowance, resetsAtUtc}) on getCurrentScene/getProfile. That single API feeds (a) the in-reader burn meter from 50% (Principle 7: no surprise paywall), (b) a candle-gutter interstitial replacing the setFreeformError dead-end with a narrative panel + 'Keep the candle burning' → /paywall?reason=daily_limit, and (c) deleting the fabricated CandleState and the user-facing variant selector on /paywall. This is THE free→paid metric fix. Keep the free 'return when the candle re-lights' door primary so the free tier stays beatable. Spec it as one unit so the three surfaces agree on the numbers.

*Key files:* apps/app/hooks/useTurn.ts:483-492, convex/ratelimit.ts + convex/billing/entitlements.ts, apps/app/app/paywall/index.tsx:52-57, apps/app/lib/dailyApi.ts (countdown helpers), CandleClock inline variant

#### [quick-win] Wire onShareEnding: publish + share at the trophy moment — Maya

Verified the slot renders in every variant the moment the prop exists — types.ts:171 literally documents the missing source. One prop pass (router.push(`/publish/${saveId}`)) plus prefilling publish metadata from the run. Targets tales-published-per-account at peak emotional investment. Check the drafted daily-killcam spec for share-surface overlap before building the post-publish share step, but the panel wire itself is uncovered.

*Key files:* apps/app/components/reading/ReaderScreen.tsx (EndingPanel prop assembly), components/death/EndingPanel.tsx:127, components/reading/layouts/types.ts:171, app/publish/[saveId]

#### [quick-win] Close the twist loop with a beatFired-mirroring twistFired field — Riley

Verified the gap exactly as claimed: no twist case in foldRegistryEvents, digest filters pending forever. The fix is an exact structural mirror of shipped plumbing (beatFired → slug-match → RegistryEvent → fold case), one prompt sentence, plus phantom-style telemetry for twists surviving to act-3. Small, self-contained, stops an active prompt-quality degradation (repeated reveal demands for already-revealed twists).

*Key files:* packages/engine/src/llm.ts (beatFired contract), convex/llm/storyBible.ts:303-352 (foldRegistryEvents), packages/engine/src/bible.ts:786-789, 904-915 (mergeBibleRefresh retire path)

#### [quick-win] Shelf cold-start + publish-loop closure bundle (house cards, isMine, handle echo, success deep links) — Dana (two proposals merged)

Merged because both are small Discover/creator polish on the same surfaces. Verified: publish returns {seedId, seed} without the pseudonym; listPublishedPublic computes ownerHandle but no isMine; template starter ids ARE in starterStories so house cards launch today via existing createSave. Blending 'kept by the house' cards into the shelf kills all three stacked empty states, and returning ownerHandle + isMine + a 'See it on the shelf'/'Watch readers arrive' pair of deep links closes the publish emotional loop for pennies.

*Key files:* apps/app/app/discover/index.tsx:204-209/:292-323, apps/app/lib/creatorTemplates.ts, convex/creatorFunctions.ts:214-216 (publish returns seed doc sans handle) + :308 (ownerHandle computed at read), convex/liveCore.ts:143 (creatorHandle), apps/app/app/creator/index.tsx publish-success state

#### [quick-win] Creator funnel instrumentation + dashboard data integrity (merged) — Dana (two proposals merged)

Merged: both are data-discipline work on the same two files. (a) Fire creator.draft_created/published/seed.launched/remixed + doors.journal events using the existing insertStoryAnalytics pattern — steering's creator-loop metrics currently have no data source. (b) Patch running playSeconds totals onto the authored_seeds row at attribution time so the Req 22.5 revenue-share number stops silently decaying past 4096 platform-wide events, and fix the affirmatively-false 48h zero-state copy. Must land BEFORE the shelf fills (wave order matters): retroactive instrumentation loses the baseline.

*Key files:* convex/creatorFunctions.ts (zero analytics_events inserts — verified), convex/creatorDashboard.ts:51 (48h QUIT_STALE_AFTER_MS), :64/:370 (EVENT_SCAN_LIMIT=4096 bounded desc scan feeds cumulative totals), apps/app/app/creator/dashboard.tsx:209 ('nobody has drifted away' copy)

#### [quick-win] Doors-journal legibility loop + ending-panel payoff (merged) — Dana (two proposals merged)

Verified all four seams: coach copy has no pointer, toast names no door, journal projects the bible's internal lockPlan label (doors[0]?.label ?? key.label) instead of the reader-seen gate label, and journal state dies with the run. Fixes: point the coach upward, name the door in the toast, project the stored reader-seen lockedHint as the label (kills BC10-adjacent plan-vs-page drift), and mount still-teased doors into the terminal ConsequenceReel as replay pressure. getDoorsJournal already works on ended saves. One coherent teaching loop instead of three disconnected surfaces.

*Key files:* apps/app/components/choices/lockCoach.ts:13-14, apps/app/components/reading/DoorsJournal.tsx:66 (anonymous toast), convex/llm/storyBible.ts:405 (plan-label projection) + :424 (getDoorsJournal query), EndingPanel/ConsequenceReel

#### [quick-win] Returning-reader home: flip the hero for anyone with a save — Maya

Pure recomposition of existing components: continue card leads, DailyCard and rank chip surface, Chapter Zero hero demotes below the fold when library.continueSave exists. First-visit layout untouched. Also partially rescues the confirmed /profile-orphan problem (rank/keepsakes invisible to guests) by surfacing the rank chip on a page guests actually see. D1 lever with near-zero backend work.

*Key files:* apps/app/app/index.tsx (hero + Continue placement), DailyCard, rank chip helpers (currently profile-only), DoorsJournal data

#### [worth-a-spec] Publish SeedStoryFlow premise adventures to the community shelf — Dana

The structural cold-start fix: the seed type readers actually produce (premise/tone/NPC cast) has no shelf path, while the thin 2-scene rule-form does — which is why every community 'adventure' is one choice deep (the confirmed form-flattening critique). A {kind:'premise'} seed reuses the entire publish metadata/visibility/forkPolicy panel and the existing createSave(OPEN_STARTER_ID, ..., seed) launch path. Needs a spec: remix semantics for premises, safety-classifier pass on publish, and dashboard aggregation for premise-kind seeds. Do after the restartRun fix so Begin-again works on these runs.

*Key files:* convex/creatorFunctions.ts (authored_seeds kind), apps/app/hooks/useLibrary.ts:170-177 (seed threading already built), SeedStoryFlow, publish metadata panel

#### [worth-a-spec] Loyalty/betrayal threshold events riding the bible cast sheet — Riley

Consumes the verified bondHint-generated-and-discarded waste and links the disjoint cast/NpcState namespaces (slug-match on spawn, stamp castId). Threshold crossings (+75 bond_crystallized, -60 bond_broken) emit one-shot prompt directives mirroring the shipped thread-fires pattern — the secret becomes a triggered betrayal instead of a forever-pending nudge. Builds directly on the companion-bonus quick win (same disposition bands); sequence it one wave later so the bands prove out first. Spoiler discipline preserved: directives are prompt-only.

*Key files:* packages/engine/src/bible.ts:95-108 (cast + bondHint), convex/llm/storyBible.ts:108/:254 (bondHint generated then dropped at scene.ts:283-284), packages/engine/src/llm.ts (disposition applier), convex/llm/prompts/scene.ts (one-shot directive pattern)

#### [worth-a-spec] Faction reputation as hidden-stat convention with a bible faction sheet — Riley

Zero new engine state — rep:<id> hidden attributes work today, and the shipped humanized-hint/near-miss UX already knows how to express standing without numbers. Needs a spec for the bible factions section, digest budget, and the prompt rule. Prompt-budget pressure is the real cost: this and the loyalty-events idea both grow scene.ts context — do NOT ship both in the same wave; measure digest token impact first.

*Key files:* packages/engine/src/stats.ts:26-49 (hidden attrs auto-create), bible section validation, locked-choice near-miss UX (shipped), endingHints

#### [worth-a-spec] Daily streak with a keepsake at 7 — Maya

The classic D1→D7 bridge and the Daily Tale is one field short of it; the keepsake-at-7 reward is story-native ('story first' compliant — the reward IS gameplay). OVERLAP WARNING: the drafted act-mementos spec owns keepsake-grant conventions and daily-killcam owns the DailyResults surface — coordinate with both specs rather than building around them; the streak computation itself (walk daily_results backwards) is uncovered by either draft.

*Key files:* convex/schema.ts daily_results, dailyFunctions:getToday, DailyCard/DailyResults, keepsakes grant pipeline

#### [worth-a-spec] Co-op host entry points ('Read together' on home + ending panel), vote-tension follow-on — Maya + Riley (vote-margin idea folded in as phase 2)

The wires themselves are small (backend and screen verified complete; only host creation is unreachable), but shipping entry points to an untrafficked mode deserves one deliberate decision: is co-op this quarter's bet? If yes, the ending-panel 'read it again, together' is the right recruitment moment and Riley's vote-margin→doom-clock mechanic is the phase-2 depth. If no, leave it dark rather than half-lit. Don't add a nav tab until session data justifies it.

*Key files:* convex/coopFunctions.ts (full backend verified: createRoom/joinRoom/castVote/passControl/recoverHost...), apps/app/app/coop, index.tsx, EndingPanel action row

#### [hard] Re-entry rail: generalize the Resend sender, abandoned-save email first, candle-relight push later — Maya (two proposals merged — shared sendTransactional plumbing)

The only items that reach players who did not open the app — the confirmed zero-return-triggers gap. Merged because both need the same generalized transactional sender + opt-out on accounts. Sequence: (1) sendTransactional helper, (2) weekly abandoned-save email using doors-journal hooks (medium, claimed accounts only, honest content the engine already wrote), (3) expo-notifications push infra for candle re-light (large: token storage, opt-in UX, Expo push action). Marked hard for the full rail; the email half alone is worth-a-spec. Gate the push half on Wave-2 funnel data showing claimed-account volume worth the infra.

*Key files:* convex/betterAuth/providers.ts (sendMagicLinkEmail), convex/crons.ts, turn_history, doors journal data, product.md feature 18

#### [hard] Light up seasons with the engine that already exists — Maya

The engine is real and tested, but 'three Convex functions' understates it: season minting ops, leaderboard write hooks, anti-cheat/dedup on entries, the mock screen rebuild, and an ongoing content cadence. Making the Daily Tale the season surface is the right cheapening move, but this is a retention bet that should wait for streak data (idea 14) proving the daily loop retains before layering competition on it. Do not ship the hardcoded-leaders screen a link, ever — either wire it live or keep it orphaned.

*Key files:* convex/seasons.ts (tested, zero runtime callers — verified), schema.ts seasons/leaderboard_entries, apps/app/app/seasons/index.tsx:7-11 (hardcoded mock), game.ts ending-unlock path

#### [hard] The World Seal: cross-tale carry for earned sequels — Riley

Highest thesis-alignment on the list ('tome that remembers across volumes' is product.md's moat) and the reader-witnessed-only construction is genuinely spoiler-safe, but it touches the turn loop, ending unlock, save creation, AND bible generation — a full spec with prompt-budget analysis. Sequence after the bible consumption loops (twists, bonds, factions) settle, so the seal has settled systems to carry. The keepsakeId carry pattern shipped in W3 is the proven template to extend.

*Key files:* game.ts keepsake mint + createSave keepsakeId pattern, endings_unlocked rows, codex flag_set rule, buildStoryBiblePrompt

### Cross-cutting notes, conflicts, and proposed waves

VERIFICATION SUMMARY: All 10 reported critiques CONFIRMED against the feat/creator-arc tree with file:line evidence; nothing misread shipped code. Five more panel critiques verified but cut by the 10-item cap, all real: publish response omits the creator's own handle + no isMine on shelf cards (creatorFunctions.ts:214/:308); zero analytics_events inserts anywhere in creatorFunctions.ts; dashboard 48h stale window + 4096-event bounded scan feeding cumulative revenue-share totals (creatorDashboard.ts:51/:64/:370) with the false 'nobody has drifted away' copy at dashboard.tsx:209; /profile reachable only from login/index.tsx:76 so guests never see rank/keepsakes; doors-journal plan-label drift (storyBible.ts:405). Left unverified (low severity, plausible): creator form flattening details, template mount-lock, home-hero critique specifics.

PERSONA CONFLICTS: (1) Maya's paywall-forward items vs product principles 'pay for joy not entry' / 'free tier stays beatable' — resolved by requiring the candle interstitial to keep the free 'return when the candle re-lights' door primary and never gating story content; the interstitial converts intent that already exists rather than manufacturing it. (2) Riley's loyalty-events and faction-rep both grow scene-prompt budget — sequence across waves, never same wave, and measure digest tokens before/after each. (3) Dana's premise-publishing changes what a 'seed' is right when Dana's own dashboard-integrity work lands — instrumentation and durable totals must ship BEFORE the shelf fills or the baseline is lost. (4) The AV persona's visual-bible and cinematic-controls proposals were truncated from my input; per the omni-cinematics spec and the standing 'no new media until engagement waves ship' direction, anything in that pair belongs inside .spec-workflow/specs/omni-cinematics as already-planned territory — merge them there rather than opening a parallel media workstream.

PROPOSED WAVES: WAVE 1 — 'Close what we opened' (~1 week, all quick-wins, no specs needed): restartRun fix, companion bond bonus, twistFired, share-slot wire, shelf cold-start + publish-loop bundle, doors-journal legibility, creator instrumentation + dashboard integrity. Rationale: every seam is where two things shipped this week meet; these are trust/integrity fixes on flagship flows and the instrumentation must precede any shelf growth. WAVE 2 — 'Make the funnel real' (~1-2 weeks, one spec: candle truth): candle-truth workstream (turns API + interstitial + de-demo paywall), turn-3 signup ribbon, returning-reader home flip. Rationale: turns the three named-but-unmeasurable product.md metrics (free→paid, guest→account, D1) into measurable, movable numbers before any retention bets — Wave 3 decisions depend on this data. WAVE 3 — 'Depth and return' (spec-first): premise publishing to the shelf, loyalty/betrayal threshold events, daily streak + keepsake (coordinated with act-mementos/daily-killcam drafts), then the email half of the re-entry rail. Faction rep follows loyalty events one wave later (prompt budget). Seasons, co-op entry points, push notifications, and World Seal stay parked pending Wave 2 funnel data and a deliberate quarterly bet on co-op.


---

## Orchestrator addendum (not from the panel)

1. The synthesis received the AV-director and cinematic-controls idea sets
   TRUNCATED and punted them to omni-cinematics territory. Their full detail
   is preserved above (personas Theo and Iris). Orchestrator's assessment:
   they form a coherent standalone MEDIA WAVE in dependency order — visual
   bible (extend the existing story-bible call; `bible.motifs` is currently a
   dead field end-to-end) → character sheets + anchor retry → drift telemetry
   → budget modes + credits ledger → "Illuminate this page" → creator-funded
   beats → phantom-cinematic upsell. First media work that is revenue-positive;
   deserves its own spec superseding the relevant omni-cinematics sections.
2. Iris's structural discovery to re-verify at build time: the entire
   metering layer (usage_meters, applyUsageDelta, includedImages/Videos,
   creditBalanceCents) is dead code — Pro video is unmetered — and
   calculateOverageCents prices video BELOW a still (inverted vs provider
   economics).
3. Known open defect carried from the creator-arc verifier (pre-existing,
   not panel-found): non-streaming submitChoice uses fetch inside a Convex
   mutation (convex/llm/httpClient.ts) and crashes with real providers;
   streaming client path unaffected.
