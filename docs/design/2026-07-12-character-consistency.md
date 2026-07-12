# Character Consistency — Build Design (2026-07-12)

Fixes the mid-story protagonist gender flip (prose) and frame-to-frame character
drift (image) by giving the protagonist — and named NPCs — one canonical,
repeated-every-turn identity. Scope: prose identity + image consistency. The
bible is stored as an opaque `jsonValue` in `story_bibles.bible`, so every new
identity field lives INSIDE that object — **no `schema.ts` change**.

## Confirmed image-consistency verdict (on record, verbatim)

> PARTIAL. PROTAGONIST is consistent ONLY on the happy path: the turn-1
> protagonist anchor image is re-passed as a reference on every later render.
> queueSceneImage reads save.anchorProtagonistAssetId/anchorSettingAssetId
> (convex/media/sceneMedia.ts:228-233) into referenceAssetIds; runImagenJob calls
> loadReferenceBytes then runGeminiImage with them (sceneMedia.ts:328-338);
> geminiImageClient wraps the prompt with "same protagonist face, same
> wardrobe... Do not change the character's identity, ethnicity, age, or clothing
> palette" (geminiImageClient.ts:80-90). This BREAKS in four ways. (a) Anchor is
> queued ONLY at turn 1 (game.ts:2188 gates on save.turnNumber===0); on provider
> failure runAnchorImageJob marks the asset failed with NO retry
> (sceneMedia.ts:1452-1459, 1497-1505), and setAnchorAssetId runs ONLY on success
> (sceneMedia.ts:1535), so a failed turn-1 anchor leaves save.anchorProtagonistAssetId
> permanently unset and EVERY later scene renders reference-less = full drift. (b)
> When Gemini Flash Image returns null (no key/API error/empty response),
> runImagenJob falls back to maybeRunImagen(args.prompt) which is Imagen 4 with NO
> references (sceneMedia.ts:345-347), and on total failure to a Picsum placeholder
> (sceneMedia.ts:368) = reference dropped. (c) Turn-2 race: loadReferenceBytes
> silently skips any anchor whose status !== "ready" (sceneMedia.ts:1296),
> rendering that scene reference-less. (d) The Veo clip only opens on the still via
> i2v when live Imagen bytes were stored; on the placeholder/fallback path
> runVeoJob runs text-only with no image reference (sceneMedia.ts:392-414,
> 605-628). NPCs are NOT consistent frame-to-frame: buildPortraitPrompt/runNpcPortraitJob
> generate ONE portrait per NPC (npcMedia.ts:257-349), but that portraitAssetId is
> never fed to the scene renderer -- loadReferenceBytes hardcodes only
> [ids.protagonist, ids.setting] (sceneMedia.ts:1289) and referenceAssetIds is
> built solely from the two save anchors (sceneMedia.ts:230-233). So every scene
> still re-invents the NPC's face from the text prompt alone. Worse, the NPC
> portrait is itself generated with the protagonist anchor as a reference but with
> an instruction to render a DIFFERENT person ("Do not duplicate the protagonist's
> face or wardrobe", npcMedia.ts:294-298), so even the portrait is anti-conditioned
> on identity. There is NO persistent textual character state anywhere in the
> render path: the scene image prompt is just visualPrompt = proposal.visualDescription
> || extractVisualFallback(prose) (game.ts:2339-2340), a fresh per-turn sentence
> with no stored name/gender/appearance appended; protagonistAnchor text is used
> once to make the anchor image then discarded (game.ts:2189-2200), never stored
> as a reusable descriptor. Consistency is 100% pixels, 0% text -- which is also
> why Flash Lite's gender flip in prose can bleed into images, and the
> geminiImageClient guard notably omits sex/gender from its lock list
> (geminiImageClient.ts:84-86). Only the endpoint Omni cinematic escapes this:
> gatherReferenceCandidatesFromDb assembles anchors + companion NPC portraits +
> key-beat stills as an Omni reference set (cinematics.ts:395-441), but that
> governs the between-act cinematic video, not the per-turn scene image or portrait.

## Root cause recap

Identity has no home. The bible plans world NOUNS (keyRegistry/lockPlan/twists/
motifs) + an NPC `cast`; nothing captures the PROTAGONIST (name/gender/pronouns/
appearance/voice). `cast` itself comes back EMPTY. So protagonist identity rests
only on the rolling summary (transient state only, `summarizer.ts:100`) + the
6-turn prose window, and Flash Lite flips gender when the pronoun signal weakens.
On the image side the only persistent identity is turn-1 anchor PIXELS, dropped by
every fallback and never re-expressed as text. The single most load-bearing fix is
a `protagonist` object on the bible, re-injected verbatim into every scene prompt
AND every image prompt.

House rules honoured: BC5 (bible/media failure never fails a turn — every new
field optional, every new path best-effort), `exactOptionalPropertyTypes` (omit
absent optionals via conditional spread), engine stays pure/prose-free,
`schema.ts`/`index.ts`/`crons.ts` untouched.

---

## 1. `protagonist` on the StoryBible (prose identity)

### 1.1 Engine type (ENGINE — `packages/engine/src/bible.ts`)

Add above `StoryBible` (near line 113):

```ts
export type BibleProtagonist = {
  name: string;         // ≤ LABEL_MAX (80)
  gender: string;       // ≤ 40, free text ("woman", "man", "nonbinary", ...)
  pronouns: string;     // ≤ 40 ("she/her")
  appearance: string[]; // 2–6 short descriptors, ≤ 60 each (hair, build, dress, age look)
  voice: string;        // ≤ HINT_MAX (120), speech register / demeanor
};
```

Make it optional on the bible so legacy stored bibles (no `protagonist` in their
opaque JSON) still load (`bible.ts:115-124`):

```ts
export type StoryBible = {
  keyRegistry: BibleKey[];
  lockPlan: BibleDoor[];
  cast: BibleCast[];
  twists: BibleTwist[];
  endingHints: BibleEndingHint[];
  motifs: string[];
  protagonist?: BibleProtagonist;   // NEW — optional (legacy-tolerant)
  source: "llm";
  version: 1;
};
```

### 1.2 Loose envelope (`storyBibleOutputSchema`, `bible.ts:132-141`)

Add `protagonist: z.unknown().optional(),` inside the `.object({...})` — it stays
`.passthrough()` and shape-check-only (hard validation is the validator's job, BC5).

### 1.3 Validation (`validateProposedBible`, `bible.ts:193-319`)

Add a new local constants: `const APPEARANCE_MAX = 6; const APPEARANCE_LEN_MAX = 60;
const GENDER_MAX = 40;`. Add a validator helper before the final `return`:

```ts
function validateProtagonist(raw: unknown): BibleProtagonist | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  const name = isString(p.name) ? clampLen(p.name, 1, LABEL_MAX) : null;
  if (name === null) return undefined;               // no name → no protagonist (tolerant)
  const appearance: string[] = [];
  const rawApp = Array.isArray(p.appearance) ? p.appearance : [];
  for (const d of rawApp) {
    if (appearance.length >= APPEARANCE_MAX) break;
    if (!isString(d)) continue;
    const t = clampLen(d, 1, APPEARANCE_LEN_MAX);
    if (t === null || appearance.includes(t)) continue;
    appearance.push(t);
  }
  return {
    name,
    gender: optionalText(p.gender, GENDER_MAX),
    pronouns: optionalText(p.pronouns, GENDER_MAX),
    appearance,
    voice: optionalText(p.voice, HINT_MAX),
  };
}
```

Then the final `return` (line 318) becomes a conditional spread so an absent
protagonist stays absent (exactOptionalPropertyTypes):

```ts
const protagonist = validateProtagonist(obj.protagonist);
return {
  keyRegistry, lockPlan, cast, twists, endingHints, motifs,
  ...(protagonist ? { protagonist } : {}),
  source: "llm", version: 1,
};
```

`mergeBibleRefresh` (`bible.ts:834-921`) must PRESERVE `protagonist` across act
refresh — identity never changes mid-story. The final return there already spreads
`...current`, so `protagonist` carries automatically; add a one-line comment noting
it is intentionally immutable (like cast/motifs/endingHints).

### 1.4 Digest (ENGINE — `BibleDigest`, `bible.ts:728-734` + `buildBibleDigest:745`)

Add `protagonist?: BibleProtagonist;` to `BibleDigest`, and in `buildBibleDigest`'s
return (`bible.ts:818-824`) pass it through VERBATIM (no band filtering — identity
is due every turn):

```ts
return {
  keys, doors, cast: ..., twists, outstanding,
  ...(bible.protagonist ? { protagonist: { ...bible.protagonist } } : {}),
};
```

### 1.5 Bible prompt asks for it (SERVER — `convex/llm/storyBible.ts:106-112`)

Insert a `protagonist` bullet at the TOP of the "EXACTLY these fields" list (before
`keyRegistry`, so the model fixes identity first):

```
'- "protagonist": { "name": string (≤80), "gender": string (≤40), "pronouns": string (≤40, e.g. "she/her"), "appearance": 2-6 short strings (≤60 each — hair, build, age-look, signature dress), "voice": string (≤120, how they speak and carry themselves) }. This is the ONE person the reader plays. Fix it now; it must NEVER change over the whole story.',
```

### 1.6 Wire response schema (SERVER — `convex/llm/responseSchema.ts:289-309`)

Add the entry object next to the other `BIBLE_*_ENTRY` consts (near line 262):

```ts
const BIBLE_PROTAGONIST_ENTRY = {
  type: "OBJECT",
  properties: {
    name:     { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    gender:   { type: "STRING", maxLength: 40 },
    pronouns: { type: "STRING", maxLength: 40 },
    appearance: { type: "ARRAY", minItems: 2, maxItems: 6,
                  items: { type: "STRING", minLength: 1, maxLength: 60 } },
    voice:    { type: "STRING", maxLength: BIBLE_HINT_MAX },
  },
  required: ["name", "gender", "pronouns", "appearance"],
} as const;
```

In `STORY_BIBLE_RESPONSE_SCHEMA` (289-309) add `protagonist: BIBLE_PROTAGONIST_ENTRY`
to `properties`, and add `"protagonist"` to the `required` array (currently
`["keyRegistry"]`).

### 1.7 Digest injection into the scene prompt (SERVER — `convex/llm/prompts/scene.ts`)

`buildStoryBibleSection` (255-317) is already wired into the prompt at `scene.ts:438`
via `request.storyBible` (a `BibleDigest`). Add a PROTAGONIST block as the FIRST
content line after the header (line 258), so identity is repeated, verbatim, every
turn ABOVE keys/doors/cast:

```ts
if (digest.protagonist) {
  const p = digest.protagonist;
  const looks = p.appearance.length > 0 ? `; ${p.appearance.join(", ")}` : "";
  lines.push(
    `PROTAGONIST (fixed — NEVER change name, gender, or pronouns): ${p.name}, ${p.gender} (${p.pronouns})${looks}. Voice: ${p.voice}. Use these pronouns consistently.`,
  );
}
```

No new render clamps needed — the strings are already validation-bounded. This is
the change that most directly kills the prose gender flip: identity is now restated
in-prompt on turn 2, 8, 15, independent of the drift-prone summary + memory window.

---

## 2. Fix the empty `cast`

**Root cause (from findings, confirmed):** NOT the prompt (`storyBible.ts:109`
already asks for 2–5 cast) and NOT engine validation (`bible.ts:250-270` already
salvages cast). It is the WIRE RESPONSE SCHEMA grammar: `STORY_BIBLE_RESPONSE_SCHEMA`
has `cast` present in `properties` (`responseSchema.ts:299`) but `required =
["keyRegistry"]` only (308) and `cast` has `maxItems:5` with **no `minItems`**.
The active provider is grammar-constrained Gemini; with cast optional and no floor,
the model satisfies the grammar by emitting an empty/omitted array on nearly every
save.

**Fix (SERVER — `responseSchema.ts:299` + 308):**

- `cast: { type: "ARRAY", minItems: 2, maxItems: 5, items: BIBLE_CAST_ENTRY }` — add `minItems: 2`.
- Add `"cast"` to the `required` array (alongside the new `"protagonist"`), so it becomes `required: ["keyRegistry", "protagonist", "cast"]`.

**Cast carries appearance too** (so named NPCs get a stable descriptor for image
prompts). Add `appearance: string` to:
- ENGINE `BibleCast` (`bible.ts:95-101`) — `appearance: string; // ≤120`, read via
  `optionalText(member.appearance, HINT_MAX)` in the cast loop (`bible.ts:263-269`).
- SERVER `BIBLE_CAST_ENTRY` properties (`responseSchema.ts:252-262`) — add
  `appearance: { type: "STRING", maxLength: BIBLE_HINT_MAX }` and add `"appearance"`
  to its `required` list.
- SERVER bible prompt cast bullet (`storyBible.ts:109`) — add
  `"appearance": string (≤120, what the reader SEES — build, hair, dress, age-look)`
  to the cast entry shape.

`buildBibleDigest` already copies cast entries wholesale (`bible.ts:821`), so
`appearance` flows into the digest and can be rendered by
`buildStoryBibleSection`'s CAST lines (optional; keep budget in mind — appearance
is primarily for the image path, §3).

---

## 3. Image consistency (MEDIA — `convex/media/**` + geminiImageClient)

Goal: the SAME identity words on every render + NPC portrait pixels as scene
references + anchor retry, all tolerant (BC5 — never fail a turn).

### 3.1 Textual identity in the image/veo prompt

The scene image prompt is built at `game.ts:2339-2340` (`visualPrompt`). Rather than
grow `game.ts`, resolve identity inside `queueSceneImage` (`sceneMedia.ts:103-264`),
which already does `ctx.db.get(saveId)` at line 227. Steps:

1. **SERVER (minimal game.ts wiring):** pass the scene's rostered NPC ids through
   the queue. At `game.ts:2342-2352` add `npcMentions: proposalForVisual?.npcMentions ?? []`
   to the `queueSceneImage` args (validator: `v.optional(v.array(v.string()))`).
2. **MEDIA:** in `queueSceneImage`, load the save's bible row (`story_bibles` by
   saveId — mirror the read used by `game.ts:3318`'s `readStoryBible`) and build an
   identity prefix, then PREPEND it to `args.prompt` before scheduling
   `runImagenJob` (`sceneMedia.ts:248`):

```ts
// buildImageIdentityPrefix(bible.protagonist, presentCast): SAME words every render.
// "CHARACTERS (render exactly, do not restyle): Protagonist — <name>, <gender>
//  (<pronouns>), <appearance joined>. <NpcName> — <cast.appearance>. "
const identityPrefix = buildImageIdentityPrefix(protagonist, presentCast);
const prompt = identityPrefix ? `${identityPrefix}\n${args.prompt}` : args.prompt;
```

   `presentCast` = bible.cast entries whose id/label matches an `args.npcMentions`
   entry (tolerant match, reuse `normalizeItemRef`-style compare). This prefix rides
   through EVERY downstream path — the Gemini reference render, the Imagen-only
   fallback (`sceneMedia.ts:345-347`, which currently drops refs AND identity), and
   text-only Veo — because it is baked into `prompt`, not into the reference bytes.
   Absent protagonist → empty prefix → byte-identical to today (legacy tolerant).

3. **Fallback parity:** because identity now lives in `prompt`, `maybeRunImagen(args.prompt)`
   (`sceneMedia.ts:345-347`) and text-only `runVeoJob` (`sceneMedia.ts:605-628`)
   automatically carry the descriptor. No extra change beyond confirming they read
   the same `prompt` string (they do).

### 3.2 NPC portrait cross-reference into scene stills

Today `referenceAssetIds` is only the two anchors and `loadReferenceBytes` hardcodes
`[ids.protagonist, ids.setting]`. Extend both to include portraits of NPCs named in
this scene:

- `queueSceneImage` (`sceneMedia.ts:230-233`): after loading the save, for each
  `args.npcMentions` id resolve `save.state.npcs[id]?.portraitAssetId` and collect
  READY ones. Build `referenceAssetIds` as `{ protagonist?, setting?, npcs?: string[] }`
  (cap total to `MAX_REFERENCE_IMAGES = 4` from geminiImageClient — protagonist +
  setting + up to 2 NPCs).
- `loadReferenceBytes` (`sceneMedia.ts:1281-1310`): change the signature to accept
  `npcs?: string[]` and iterate `[ids.protagonist, ids.setting, ...(ids.npcs ?? [])]`
  (line 1289). Same ready/storageId guard (1296) applies — a not-ready portrait is
  silently skipped (tolerant). Order keeps protagonist first (face weighting).
- Thread `referenceAssetIds.npcs` through the `runImagenJob` schedule args
  (`sceneMedia.ts:256-259`) and its arg validator.

This gives a named NPC ONE face across scenes. (The endpoint Omni path already does
this via `cinematics.ts:395-441`; we are extending it to per-turn stills.)

### 3.3 Anchor-image RETRY + lazy backfill

Turn-1 anchor failure currently un-anchors the ENTIRE run with no retry
(`sceneMedia.ts:1452-1459, 1497-1505`). Two fixes, mirroring the existing bounded
Veo-poll reschedule pattern (`sceneMedia.ts:662-714`, attempt count on provenance):

1. **Bounded retry:** in `runAnchorImageJob`, on the two failure branches, read an
   `attempt` count (stamped on provenance like `veoAttempt`), and while
   `attempt < ANCHOR_MAX_ATTEMPTS` (e.g. 3) `ctx.scheduler.runAfter(delay,
   "media/sceneMedia:runAnchorImageJob", { ...args, attempt: attempt+1 })` instead of
   only `markFailed`. Only mark failed after the last attempt. Add `attempt` to the
   job args (default 0).
2. **Lazy backfill:** in `queueSceneImage`, when `save.turnNumber > 0` and
   `save.anchorProtagonistAssetId` is still unset, and the bible has a
   `protagonist`, queue a protagonist anchor from a descriptor built off
   `bible.protagonist` (name + gender + appearance) — reusing `queueAnchorImage`.
   This escapes the `game.ts:2188` turn-1-only trap: a run whose turn-1 anchor died
   still gets anchored on turn 2+. Best-effort, wrapped in try/catch.

### 3.4 Strengthen the consistency wrapper (MEDIA — `geminiImageClient.ts:84-86`)

Add sex/gender and hair to the lock list so the reference dominates any residual
prose pronoun drift:

```
"same protagonist face, same SEX/GENDER, same hair, same wardrobe, same setting
 style. Do not change the character's identity, sex, gender, ethnicity, age, hair,
 or clothing palette."
```

---

## 4. Build-phase ownership split (avoid game.ts / schema.ts collisions)

| Owner  | Files | Work |
|--------|-------|------|
| **ENGINE** | `packages/engine/src/bible.ts` (+ its type exports) | `BibleProtagonist` type; `protagonist?` on `StoryBible` + `BibleDigest`; loose-envelope field; `validateProposedBible` protagonist salvage + `BibleCast.appearance`; `buildBibleDigest` pass-through; `mergeBibleRefresh` immutability comment. Pure, no console/Date. |
| **SERVER** | `convex/llm/storyBible.ts`, `convex/llm/responseSchema.ts`, `convex/llm/prompts/scene.ts`, minimal `convex/game.ts` | Bible prompt asks for `protagonist` + `appearance` on cast; `BIBLE_PROTAGONIST_ENTRY` + `required`/`minItems` cast fix + cast-entry appearance in `responseSchema.ts`; PROTAGONIST render block in `buildStoryBibleSection`; ONE-LINE `game.ts:2342-2352` change to pass `npcMentions` into `queueSceneImage`. **Does NOT touch `schema.ts`.** |
| **MEDIA** | `convex/media/sceneMedia.ts`, `convex/media/geminiImageClient.ts` | `buildImageIdentityPrefix` + prepend in `queueSceneImage`; NPC portrait cross-ref in `referenceAssetIds` + `loadReferenceBytes` + `runImagenJob` args; anchor retry (`runAnchorImageJob`) + lazy backfill (`queueSceneImage`); gender/hair in `geminiImageClient` lock list. |

`schema.ts` / `index.ts` / `crons.ts` are integrator-reserved and untouched — every
new field lives in the opaque `story_bibles.bible` JSON or is passed as a job arg.
The only shared file is `game.ts`, and SERVER's edit there is a single added arg on
an existing `queueSceneImage` call (2342-2352) — MEDIA does not edit `game.ts`.

---

## 5. Verification plan

**Unit (ENGINE — `packages/engine` vitest):**
- `validateProposedBible` with a well-formed `protagonist` → returned verbatim
  (name/gender/pronouns/appearance clamped, ≤6 appearance items, dedup).
- Missing/empty `name` → `protagonist` omitted, bible still salvages on keys.
- Legacy bible JSON with NO `protagonist` → loads, `buildBibleDigest.protagonist`
  undefined, section byte-identical to today.
- `mergeBibleRefresh` preserves `protagonist` unchanged across an act refresh.
- `BibleCast.appearance` salvaged and present in the digest cast entries.

**Unit (SERVER — convex vitest):**
- `STORY_BIBLE_RESPONSE_SCHEMA` pin test updated: `protagonist` in properties,
  `required` includes `protagonist` + `cast`, `cast.minItems === 2`,
  `BIBLE_CAST_ENTRY` has `appearance`.
- `buildStoryBibleSection` renders the PROTAGONIST line first with exact
  name/gender/pronouns when `digest.protagonist` is set; emits nothing new when
  absent.

**Unit (MEDIA — convex vitest):**
- `buildImageIdentityPrefix` produces the SAME string for the same protagonist
  across turns; includes matched NPC appearance for a mentioned id; empty when no
  protagonist.
- `loadReferenceBytes` iterates protagonist + setting + NPC portrait ids and skips
  non-ready assets.
- Anchor retry: a null-returning `runGeminiImage` reschedules until
  `ANCHOR_MAX_ATTEMPTS`, then `markFailed` (assert no throw — turn never fails).

**Live check (comet save, real Gemini 3.1 Flash Lite via vertex.ts:191 override,
dockerized cyoa-local):**
- Regenerate/advance the comet story; dump the turn-N scene prompt and assert the
  `PROTAGONIST (fixed ...)` line appears with a stable name + pronouns on turns 1,
  2, and a late turn (was absent before).
- Assert `cast` in the stored bible is non-empty (≥2) with `appearance` set.
- Dump the queued scene IMAGE prompt (`queueSceneImage` input) and assert the
  `CHARACTERS (render exactly ...)` identity prefix is present and identical across
  two consecutive scenes; when the scene names a rostered NPC, assert that NPC's
  `portraitAssetId` is in `referenceAssetIds`.
- Confirm no turn errors (BC5) throughout.
