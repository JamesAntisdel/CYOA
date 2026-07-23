# UX + PM Review — Reader Chrome Declutter (pre-build)

Date: 2026-07-20. Reviewed artifact: `.spec-workflow/specs/
reader-chrome-declutter/` (direction "The Ribbon" + R7 desktop amendments)
and `docs/design/2026-07-20-ui-overhaul-brainstorm.md` (phasing).
Method: walked ten concrete reader/home flows against the spec, then
audited it against the steering success metrics (activation ≥5 turns,
guest→account, free→paid, daily participation) and compliance posture.
Every finding carries a disposition; AMENDED findings are already applied
to the spec (marked U*/P* inline there).

## UX findings

| id | finding | severity | disposition |
|---|---|---|---|
| U1 | The collapsed ribbon demoted the reader's ACTIVE GOAL. QuestLine's pursuit phrase ("find the bell before dawn") is the most engagement-load-bearing line in the reader; reducing it to "Act II · counts" trades the product's core loop for tidiness. | HIGH | **AMENDED** — R3.1: ribbon leads with the truncated pursuit phrase, counts follow. |
| U2 | An icon-only `book` glyph as the Tome trigger is undiscoverable — a first-session reader would never find Path map / Run history / Auto once the visible pills are gone. | HIGH | **AMENDED** — R1.1: trigger is glyph + "Tome" text at every width; the label is the coach mark. |
| U3 | Moving "✦ AI-generated · Flag scene" wholesale into the sheet hides the GenAI DISCLOSURE, not just the report action. Disclosure posture should be visible-always; report-in-menu is fine (standard overflow pattern). | HIGH (compliance-adjacent) | **AMENDED** — new R2.5: persistent plain-text footer caption on generated scenes; flag action stays in the Tome. |
| U4 | Shrinking the candle meter to a top-bar wick weakens the "no surprise cap" principle and the free→paid prompt right where it converts (the approach to the gutter). | MED-HIGH | **AMENDED** — R3.4: two-stage candle. Wick at ≥50%; at ≥80% a leading book-voice ribbon segment links to the full meter + patronage door. Gutter interstitial untouched. |
| U5 | Desktop popovers specced without keyboard semantics. | MED | **AMENDED** — R2.3: web Escape-close, focus trap, focus restore to trigger. |
| U6 | Top-right Tome trigger is the worst one-handed phone reach zone. | LOW | **ACCEPTED** — the menu is an infrequent action; the frequent actions (choices, page-turn) stay in the thumb zone. Revisit if session data ever exists (P3). |
| U7 | Reading settings become 2 taps (was 1). | LOW | **ACCEPTED** — settings are rare mid-tale (the drawer's own header says so); the trade buys the whole pill row back. |
| U8 | Auto-read: enable = 2 taps (sheet), pause = 1 tap (top bar). | — | **CONFIRMED CORRECT** — pausing is the urgent path; enabling is deliberate. Manual choice tap still grabs the wheel. |
| U9 | Ribbon at turn 0 / legacy saves renders nothing — first paint is TopBar → media → prose. | — | **CONFIRMED** — matches RC2; the cleanest possible first impression for activation. |
| U10 | Novel mode: ribbon still works (novel keeps the arc spine); Auto + Tome compose; ChapterEnd untouched. | — | **CONFIRMED** — no novel-specific gaps found. |

## PM findings

| id | finding | severity | disposition |
|---|---|---|---|
| P1 | Wave order shipped the invisible refactor first. Settings unification and the chrome overhaul are file-disjoint (verified ownership sets) — the user-visible win should lead. | MED | **AMENDED** — waves reordered: 1 chrome, 2 settings, 3 polish. |
| P2 | "Chrome: Book/Focus" (`layoutMode`) is a DEAD setting — typed, persisted, rendered, consumed by nothing (grep-verified). Dead controls erode trust in the whole settings surface. | MED | **AMENDED** — R4.3: group removed, field retired with tolerant parse; "Focus" name reserved for phase-2 Candlelight Focus. |
| P3 | No client→server analytics path exists, so Tome/ribbon engagement CANNOT be measured without new server surface (out of the spec's client-only scope). | MED | **ACCEPTED + DOCUMENTED** — "Measurement & accepted risks" section added: watch existing signals pre/post (activation, soft-signup conversions, `reason=daily_limit` paywall entries, daily participation); a one-event analytics follow-up spec is named debt. |
| P4 | Delivery risk concentrates in the ReaderScreen swap — the same file carries this cycle's Novel dispatch, daily-pulse threading, and act-boundary lines. | MED | **MITIGATED IN SPEC** — RC6 drift-guards updated in the same commit, full suite + two-width live check gate the wave; called out inside task 1.3 itself. |
| P5 | Rollback: static-export deploys make rollback `git revert` + `docker compose restart app`. | LOW | **CONFIRMED** adequate; documented. |
| P6 | Flag action at 2 taps in an overflow menu is within accepted app-store reporting norms **provided** the disclosure itself stays visible. | — | **RESOLVED BY U3.** |
| P7 | Funnel surfaces inventory-check: age gate, tutorial start, soft-signup ribbon, candle gutter, paywall doors, daily card — every one is untouched or strengthened (U4) by the spec. | — | **CONFIRMED** — RC3 protects them; the gate task verifies each. |
| P8 | Phasing sanity (overhaul doc): Open Book as phase-2 flagship is the right bet — it reuses `ReaderLayoutProps` (bounded), pays off the metaphor on the widest screens, and Candlelight Focus rides along cheaply. The Desk stays gated on art budget. | — | **CONFIRMED** — no change. |

## Verdict

The direction survives review; the four HIGH/MED-HIGH findings were real
design errors (U1 especially — the original mock optimized for tidiness
over the engagement loop) and are now amended in the spec. With those
applied, the plan protects every funnel surface, improves the activation
path (prose at ~row 3 on phone, page-column on desktop), and removes the
duplication debt. Ready to build: Wave 1 (chrome) → Wave 2 (settings) →
Wave 3 (polish), each behind the two-width merge gate.

---

## Post-build addendum (2026-07-21): code-review sweep + conformance verdict

**Code-review sweep** (5 dimensions planned; the react-pitfalls reviewer
completed before a session-limit interruption; its 6 findings were then
hand-verified against the code — ALL SIX CONFIRMED — and fixed):

1. TomeSheet's focus-trap effect depended on the unstable `onClose` prop —
   focus yanked out of the open modal on every background re-render
   (streaming ticks). Fixed: ref-held callback, effect keyed on `open` only.
2. `DailyPulseChip.onPulseLine` never fired `undefined`, so the collapsed
   ribbon held a stale percentage after the pulse degraded. Fixed: fires on
   every change; segment clears.
3. StoryRibbon's collapsed detail used a height-0 clip — on react-native-web
   the hidden Pressables stayed keyboard-focusable and Enter-activatable
   (invisible paywall button). Fixed: `display:"none"` (components stay
   mounted; R3.3 toasts still fire).
4. `PAGE_COLUMN_MAX` was declared twice (RC9 violation). Fixed: single
   source in ribbonSegments, re-exported.
5. The RB-COUNTS headless twin mounts DOUBLED every doors/pulse fetch per
   scene. Fixed: reporters threaded into StoryRibbon's own detail mounts;
   twins deleted; DoorsJournal's toast-deferral coupling removed (single
   mount now owns both report + toast).
6. Tome row → drawer/report handoff opened one RN Modal in the same commit
   another dismissed (iOS drops the incoming modal). Fixed: platform-guarded
   sequencing (immediate on web, deferred past dismiss on native).

All drift-guards retargeted to the fixed behavior in the same change, with
negative assertions pinning each bug class. Gate: monorepo typecheck clean,
app node --test 447/447, app serving.

**Conformance verdict:** a mechanical criterion-by-criterion check of the
amended spec (R1–R7 + review deltas U1–U5) returned **27/27 MET** on the
post-fix tree — including the four review-delta fixes (pursuit-first ribbon,
labeled Tome trigger, persistent AI disclosure, two-stage candle), the
protected-surface invariants (RC3), and the desktop page-column/nav-band/
popover requirements (R7). The improved design is met as specified.
