# CYOA Game Design

_Started 2026-04-26 05:48 UTC_

---

## User

lets start with a conversation about this CYOA game. it will be an online game available via a url. explore the core elements including onboarding, game experience, social, etc

## Assistant

I'll read your spec first so the conversation is grounded in what you've actually written.

_[tool: read_file]_

Good — spec read. Before I sketch wireframes, I want to map the full surface area with you. The spec covers the in-game reading experience well, but you mentioned this is a URL-accessible online game with onboarding and social — so there's a lot of product surrounding the engine that isn't in the doc yet.

I'll declare my aesthetic up front so we stay aligned: **low-fi sketchy wireframes** — handwritten-but-readable type (Caveat / Patrick Hand style), mostly black ink on off-white, one accent color sparingly for emphasis. Breadth over polish — 3-5 distinct directions per surface so we can compare structures, not pixels.

Now the questions. Answer what you can; "decide for me" is always fine.

_[tool: questions_v2]_

## User

Questions answered:
- product_shape: we have a self-generating story using llm, ai, memory, etc. to build a rich story. have a base of starter adventures including onboaridng ones where you train or escape the training room.
- first_visit: all of the above but we need to allow registration and saving games
- account_model: Optional — play guest, sign up to sync/share
- reading_layout: Like a book — centered column, generous margins, paged, Offer upgrade options to make graphic novel, we can do a few settings. also make this built so we can use expo and do a ios/android experience
- stats_visibility: Always visible but allow different modes user can choose.
- social_features: Co-op or pass-the-controller multiplayer
- ending_tracking: Map or web showing branches you've taken
- mode_framing: Toggleable mid-game (with caveats)
- death_feel: Brutal — full screen, dramatic, final
- wireframe_surfaces: Decide for me — pick the essentials
- tone: Mysterious / gothic — old tome, candlelight
- monetization: we want a free mode but limit to a number of plays/turns a day. if you want to continue you can subscribe. offer pro plans with storybook images, etc.
- device_priority: Both equally — design responsive

## User

how can i see the preview files?

## Assistant

Good question — there's nothing to preview yet. We just finished the Q&A; I haven't drawn anything. Once I produce a wireframe HTML file it'll show up in your preview pane automatically.

Let me get to work now. Plan based on your answers:

**Product:** AI-generated CYOA with curated starter adventures (incl. tutorial "escape the training room"). Free tier with daily turn limits → subscription → pro tier with storybook images. Gothic/candlelight tone. Web + future Expo (iOS/Android).

**Surfaces I'll wireframe (3-5 variations each):**
1. Landing / cover
2. Onboarding (registration optional, mode pick, character/story creation)
3. Main reading view — book layout, with toggleable graphic-novel mode
4. Stats HUD (multiple visibility modes)
5. Choice moments + scene transitions
6. Death screen (brutal)
7. Endings map / web
8. Co-op / pass-the-controller
9. Paywall / turn-limit moments
10. Settings (theme, font, audio)

I'll build this as a low-fi sketchy wireframe canvas so you can compare options side-by-side. Let me start.

_[tool: update_todos]_

_[tool: copy_starter_component]_

Now let me build the wireframe canvas. I'll set up the main HTML file with sketchy primitives, then add artboards section by section.

_[tool: write_file]_

Now the artboards. I'll split them into a few JSX files to keep each under control. Starting with the first batch:

_[tool: write_file]_

_[tool: write_file]_

[S]

_[tool: snip]_

_[tool: write_file]_

Now the main HTML that ties everything together.

_[tool: read_file]_

[S]

_[tool: snip]_

_[tool: write_file]_

_[tool: done]_

[S]

_[tool: sleep]_

[S]

_[tool: done]_

[S]

_[tool: snip]_

Spaces in the filename are likely tripping the script loader. The babel script-src loader has trouble fetching files with spaces. Let me check and fix — I'll remove spaces from referenced files (or rather, the issue is the loader fetching .jsx files via spaces). Actually the file paths in the script tags don't have spaces. Let me look at the actual issue — the loader is failing to fetch the .jsx files. This often happens when files load before the previous render. Let me inline the primitives export for `WobbleFilter` and check.

Actually the real issue: `WobbleFilter` is referenced in App but the boards files might not have loaded yet. Let me check by adding a small load delay/retry, or simpler — just inline everything in fewer files or use a load-check.

Simplest fix: wait for all globals before mounting.

_[tool: str_replace_edit]_

[S]

I also need to make sure `WobbleFilter` etc. are explicitly attached to window in the primitives file. Let me check:

_[tool: grep]_

[S]

_[tool: snip]_

_[tool: done]_

[S]

_[tool: sleep]_

[S]

_[tool: done]_

[S]

_[tool: snip]_

The babel script-src loader keeps failing intermittently — likely it's actually a transient issue but I should be more robust. Let me consolidate into fewer files. I'll inline everything into the main HTML using a fetch-and-eval approach, OR just bundle everything into one big babel block by reading and concatenating.

Actually simplest: load files via fetch + eval inside a single inline babel block, OR just inline all the JSX into one file. Let me try the latter approach by reading and combining everything.

_[tool: run_script]_

[S]

_[tool: str_replace_edit]_

[S]

_[tool: snip]_

_[tool: done]_

[S]

_[tool: sleep]_

[S]

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

_[tool: show_html]_

[S]

_[tool: show_html]_

[S]

_[tool: snip]_

_[tool: get_webview_logs]_

[S]

_[tool: snip]_

The babel script-src loader is failing repeatedly. Let me try fetching the files manually and feeding them to babel via inline scripts. This is more reliable.

_[tool: run_script]_

[S]

_[tool: snip]_

Files exist on disk but Babel's loader can't fetch them — likely an issue with how it requests .jsx via the dev server. Let me try a different approach: use fetch to load files into text, then create inline script tags. This bypasses Babel's broken src-loader.

_[tool: str_replace_edit]_

[S]

_[tool: snip]_

[S]

_[tool: done]_

[S]

_[tool: snip]_

_[tool: get_webview_logs]_

[S]

_[tool: snip]_

Found it! The fetch is returning "preview token required" — auth issue. The fetch needs to use the same context. Let me check what URL fetch is using.

The .jsx files DO load when fetched by Babel directly (eventually), but my own fetch() call gets "preview token required" because it's hitting the bare URL without auth. The babel src-loader was actually working sometimes — the failure was likely a race.

Better approach: just inline EVERYTHING in one HTML file. No external scripts.

_[tool: run_script]_

[S]

_[tool: snip]_

_[tool: done]_

[S]

_[tool: snip]_

_[tool: fork_verifier_agent]_

Wireframes are live. Drag artboards to reorder, click any to focus fullscreen.

**What's on the canvas:**
1. Landing — 5 takes (tome cover, library, straight-to-scene, prompt-first, mobile)
2. Onboarding — tutorial / character creation / weave-a-tale / mode picker / soft signup
3. Reading view — book / app / graphic-novel / journal / mobile
4. Stats HUD — 4 visibility modes
5. Death — brutal / bookish / cinematic
6. Endings — branching web + trophy crypt
7. Co-op — setup / turn indicator / vote mode
8. Paywall — daily limit / ambient / Pro upsell
9. Settings — single panel

**Open questions baked into annotations** worth resolving next:
- Free turns/day number (placeholder: 5)
- Hardcore mode-switching rules — I assumed downgrade OK, upgrade caveats
- Co-op: device-only first, or remote rooms day-one?
- AI seeding flow — how much steering before story starts?

Tell me which directions to pursue and I'll go hi-fi on those.

