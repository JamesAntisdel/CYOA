// Wireframe artboards — Part 1: Intro/system, Landing, Onboarding

const IntroBoard = () => (
  <div style={{ width: 1100, padding: 30, background: inkStyles.paper }}>
    <SText size={56} weight={700}>CYOA — Wireframe Explorations</SText>
    <SBody size={18}>
      Low-fi sketches for an AI-generated choose-your-own-adventure web game.
      Sketchy & wobbly on purpose — these are about <em>structure</em> and <em>flow</em>, not visual polish.
      Drag artboards around, click any to focus.
    </SBody>
    <SDivider />

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 12 }}>
      <div>
        <SText size={26} weight={700}>The product</SText>
        <SBody>
          • A URL anyone can hit — play as guest, sign up to save & share.<br />
          • Stories are <strong>AI-generated on the fly</strong> with persistent memory + branching.<br />
          • Curated <strong>starter adventures</strong> seed the experience (incl. tutorial: <em>"Escape the Training Room"</em>).<br />
          • <strong>Free tier</strong> = limited turns/day. <strong>Subscription</strong> unlocks unlimited; <strong>Pro</strong> adds storybook imagery & ambient sound.<br />
          • Tone: gothic, candlelit, "living book."<br />
          • Built so the same UI can ship to web + native (Expo).
        </SBody>
      </div>
      <div>
        <SText size={26} weight={700}>The system I'm using</SText>
        <SBody>
          <strong>Type</strong> — Caveat (titles), Patrick Hand (body). Stand-ins for hand-lettering.<br />
          <strong>Color</strong> — black ink on aged parchment. <span style={{ color: inkStyles.accent }}>Wax-seal red</span> for emphasis only. <span style={{ color: inkStyles.highlight }}>Candle gold</span> for highlights.<br />
          <strong>Frames</strong> — browser & phone, side-by-side, since both surfaces matter.<br />
          <strong>Variants</strong> — 3+ per surface, ordered <em>conventional → adventurous</em>. Pick & mix.<br />
          <strong>Annotations</strong> — red italic notes call out reasoning.
        </SBody>
      </div>
    </div>

    <SDivider style={{ marginTop: 20 }} />
    <SText size={22} weight={700}>What's covered below</SText>
    <SBody>
      Landing → Onboarding → Reading view (the main event) → Stats HUD modes → Choices & consequences →
      Death screen → Endings map → Co-op multiplayer → Paywall moments → Settings.
    </SBody>
    <SBody size={14} color={inkStyles.inkFaint}>
      Open questions are flagged in red on each board — let's resolve them as we go.
    </SBody>
  </div>
);

// ────────────────────────────────────────────────────────────────────────
// LANDING / COVER
// ────────────────────────────────────────────────────────────────────────

const Landing_TomeCover = () => (
  <SBrowser w={680} h={460} url="cyoa.game">
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: inkStyles.paper, position: 'relative' }}>
      <SImg w={220} h={280} label="cover illustration / animated candle" />
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <SText size={32} weight={700}>The Unwritten</SText>
        <SBody size={13} style={{ marginTop: -2 }}>an adventure that writes itself</SBody>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <SBtn primary>Open the book</SBtn>
        <SBtn>I have a save</SBtn>
      </div>
      <div style={{ position: 'absolute', top: 12, right: 16, display: 'flex', gap: 8 }}>
        <SBtn>sign in</SBtn>
      </div>
      <SBody size={12} style={{ marginTop: 16, color: inkStyles.inkFaint }}>
        no sign-up required · 5 free turns/day
      </SBody>
    </div>
  </SBrowser>
);

const Landing_Library = () => (
  <SBrowser w={680} h={460} url="cyoa.game">
    <div style={{ padding: 18, height: '100%', background: inkStyles.paper }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <SText size={26} weight={700}>The Library</SText>
        <div style={{ display: 'flex', gap: 6 }}>
          <SBtn>guest</SBtn>
          <SBtn primary>sign in</SBtn>
        </div>
      </div>
      <SBody size={13}>Choose a tale, or weave your own.</SBody>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { t: 'The Training Room', sub: 'tutorial · 5 min', hot: true },
          { t: 'Bone Cathedral', sub: 'gothic · long' },
          { t: 'The Iron Court', sub: 'intrigue · medium' },
          { t: 'Ashfall', sub: 'survival · hard' },
        ].map((s, i) => (
          <div key={i} style={{ border: `1.5px solid ${inkStyles.ink}`, padding: 8, filter: 'url(#wobble)' }}>
            <SImg h={70} label="" />
            <SText size={16} weight={700} style={{ display: 'block', marginTop: 6 }}>{s.t}</SText>
            <SBody size={11} style={{ margin: 0 }}>{s.sub}</SBody>
            {s.hot && <SBody size={11} style={{ color: inkStyles.accent, margin: 0 }}>↳ start here</SBody>}
          </div>
        ))}
      </div>
      <SDivider style={{ marginTop: 14 }} />
      <SText size={18} weight={700}>… or weave a new tale</SText>
      <SBox style={{ marginTop: 6, padding: 12 }}>
        <SBody size={12} style={{ margin: 0 }}>"A detective in a city where everyone's forgotten their name…"</SBody>
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
          <SBtn primary>Begin</SBtn>
        </div>
      </SBox>
    </div>
  </SBrowser>
);

const Landing_StraightToScene = () => (
  <SBrowser w={680} h={460} url="cyoa.game">
    <div style={{ padding: 30, height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column' }}>
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>chapter the first</SBody>
      <SText size={22} weight={700} italic>The Door That Wasn't There Yesterday</SText>
      <SDivider />
      <div style={{ flex: 1, fontFamily: '"Patrick Hand", cursive', fontSize: 14, color: inkStyles.ink, lineHeight: 1.5 }}>
        You wake in a room you do not remember entering. The candle gutters. Three doors —
        one bound in iron, one carved with names, one merely a rumor of a door, painted on the wall.
        <br /><br />
        Somewhere, distant, a clock that should not exist begins to chime…
      </div>
      <SChoice num="1">Try the iron door.</SChoice>
      <SChoice num="2">Read the names on the carved door.</SChoice>
      <SChoice num="3">Touch the painted door.</SChoice>
      <div style={{ position: 'absolute', top: 12, right: 16 }}>
        <SBtn>save & sign up →</SBtn>
      </div>
      <SNote style={{ marginTop: 4 }}>no friction. story first. CTA to save appears after 2-3 choices.</SNote>
    </div>
  </SBrowser>
);

const Landing_PromptFirst = () => (
  <SBrowser w={680} h={460} url="cyoa.game">
    <div style={{ padding: 32, height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <SText size={28} weight={700} italic align="center">Tell me a tale,<br />and I shall tell it back to you.</SText>
      <div style={{ width: '85%', marginTop: 22 }}>
        <SBox style={{ minHeight: 80, padding: 14 }}>
          <SBody size={13} color={inkStyles.inkFaint} style={{ margin: 0 }}>
            ✒ a storm-wrecked lighthouse… a thief in a city of glass… a memory you shouldn't have…
          </SBody>
        </SBox>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <SBtn>🎲 surprise me</SBtn>
            <SBtn>browse tales</SBtn>
          </div>
          <SBtn primary>open the book →</SBtn>
        </div>
      </div>
      <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 18 }}>guest mode · 5 turns free</SBody>
    </div>
  </SBrowser>
);

const Landing_Mobile = () => (
  <SPhone>
    <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ alignSelf: 'flex-end' }}>
        <SBtn>sign in</SBtn>
      </div>
      <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <SImg w={140} h={180} label="cover" />
        <SText size={26} weight={700} style={{ marginTop: 12 }}>The Unwritten</SText>
        <SBody size={11}>an adventure that writes itself</SBody>
      </div>
      <div style={{ width: '100%' }}>
        <SBtn primary style={{ width: '100%', padding: '10px 0' }}>Open the book</SBtn>
        <SBody size={10} color={inkStyles.inkFaint} style={{ textAlign: 'center', marginTop: 6 }}>
          5 free turns/day · no sign-up
        </SBody>
      </div>
    </div>
  </SPhone>
);

window.LandingBoards = { Landing_TomeCover, Landing_Library, Landing_StraightToScene, Landing_PromptFirst, Landing_Mobile };

// ────────────────────────────────────────────────────────────────────────
// ONBOARDING
// ────────────────────────────────────────────────────────────────────────

const Onboard_TutorialFirst = () => (
  <SBrowser w={680} h={460} url="cyoa.game/training-room">
    <div style={{ padding: 28, height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>tutorial · room 1 of 3</SBody>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={{ width: 22, height: 4, background: n === 1 ? inkStyles.ink : inkStyles.inkFaint }} />
          ))}
        </div>
      </div>
      <SText size={22} weight={700} italic style={{ marginTop: 4 }}>The Training Room</SText>
      <SDivider />
      <div style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 14, lineHeight: 1.5, color: inkStyles.ink, flex: 1 }}>
        Stone walls. A locked door. A note on the table reads:<br />
        <em>"Every choice you make will change the story. Try one."</em>
      </div>
      <SChoice num="1">Read the note again. <span style={{ color: inkStyles.accent }}>(+1 wisdom)</span></SChoice>
      <SChoice num="2">Try the door.</SChoice>
      <SBox style={{ position: 'absolute', bottom: 14, right: 14, padding: 8, maxWidth: 200, background: inkStyles.paperDark }} accent>
        <SBody size={11} style={{ margin: 0, color: inkStyles.accent }}>
          ✦ stats live up here →<br />choices change them. watch.
        </SBody>
      </SBox>
    </div>
  </SBrowser>
);

const Onboard_CharacterCreation = () => (
  <SBrowser w={680} h={460} url="cyoa.game/begin">
    <div style={{ padding: 22, height: '100%', background: inkStyles.paper }}>
      <SText size={22} weight={700}>Who are you, traveler?</SText>
      <SBody size={12}>your name is the only thing the book cannot invent.</SBody>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, marginTop: 14 }}>
        <div>
          <SImg h={180} label="portrait — auto-illustrated" />
          <SBtn style={{ marginTop: 6, width: '100%' }}>↻ regenerate</SBtn>
        </div>
        <div>
          <SBody size={12} style={{ margin: 0 }}>name</SBody>
          <SBox style={{ padding: 6 }}>
            <SText size={18} italic>Wren of Ashbourne</SText>
          </SBox>
          <SBody size={12} style={{ margin: '10px 0 0' }}>archetype</SBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
            <SBox filled style={{ padding: 8 }}><SText size={14} weight={700}>The Scholar</SText></SBox>
            <SBox style={{ padding: 8 }}><SText size={14}>The Brigand</SText></SBox>
            <SBox style={{ padding: 8 }}><SText size={14}>The Heretic</SText></SBox>
            <SBox style={{ padding: 8 }}><SText size={14}>The Stranger</SText></SBox>
          </div>
          <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 4 }}>
            ↳ archetype seeds your starting stats and the AI's voice.
          </SBody>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <SBtn primary>begin →</SBtn>
      </div>
    </div>
  </SBrowser>
);

const Onboard_PromptToScene = () => (
  <SBrowser w={680} h={460} url="cyoa.game/weave">
    <div style={{ padding: 22, height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column' }}>
      <SText size={22} weight={700}>Weave a tale</SText>
      <SDivider />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <SBody size={12}>setting</SBody>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {['Victorian London', 'haunted abbey', 'sunken city', 'ice steppe', '+ custom'].map((t) => (
              <SBox key={t} filled={t === 'haunted abbey'} style={{ padding: '3px 8px' }}>
                <SText size={14}>{t}</SText>
              </SBox>
            ))}
          </div>
          <SBody size={12} style={{ marginTop: 10 }}>tone</SBody>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {['gothic', 'whimsical', 'cosmic dread', 'noir'].map((t) => (
              <SBox key={t} filled={t === 'gothic'} style={{ padding: '3px 8px' }}>
                <SText size={14}>{t}</SText>
              </SBox>
            ))}
          </div>
          <SBody size={12} style={{ marginTop: 10 }}>length</SBody>
          <div style={{ display: 'flex', gap: 4 }}>
            {['short (15m)', 'medium (1h)', 'epic (open)'].map((t) => (
              <SBox key={t} filled={t === 'medium (1h)'} style={{ padding: '3px 8px' }}>
                <SText size={14}>{t}</SText>
              </SBox>
            ))}
          </div>
        </div>
        <div>
          <SBody size={12}>seed (optional)</SBody>
          <SBox style={{ minHeight: 70, padding: 8 }}>
            <SBody size={12} color={inkStyles.inkFaint} style={{ margin: 0 }}>
              "I want a story about a librarian who finds a book that's writing itself, in real time, about her."
            </SBody>
          </SBox>
          <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 6 }}>
            ↳ the AI uses this as the opening. you can leave it blank.
          </SBody>
        </div>
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SBtn>🎲 surprise me</SBtn>
        <SBtn primary>weave →</SBtn>
      </div>
    </div>
  </SBrowser>
);

const Onboard_ModePick = () => (
  <SBrowser w={680} h={460} url="cyoa.game/mode">
    <div style={{ padding: 24, height: '100%', background: inkStyles.paper }}>
      <SText size={22} weight={700}>How will you read?</SText>
      <SBody size={12}>you can switch later (with caveats).</SBody>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <SBox style={{ padding: 16, minHeight: 200 }}>
          <SText size={20} weight={700}>📖 Story Mode</SText>
          <SDivider />
          <SBody size={12} style={{ margin: 0 }}>
            ✓ rewind one step<br />
            ✓ bookmark anywhere<br />
            ✓ death = retry<br />
            ✓ stats softened
          </SBody>
          <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 8 }}>
            for explorers who want the tale.
          </SBody>
        </SBox>
        <SBox style={{ padding: 16, minHeight: 200, borderColor: inkStyles.accent }} accent>
          <SText size={20} weight={700} color={inkStyles.accent}>🜏 Hardcore</SText>
          <SDivider />
          <SBody size={12} style={{ margin: 0 }}>
            ✗ no rewind<br />
            ✗ no save scumming<br />
            ⚠ permadeath — file is purged<br />
            ✓ unique endings unlocked here only
          </SBody>
          <SBody size={11} color={inkStyles.accent} style={{ marginTop: 8 }}>
            for survivors. every choice is final.
          </SBody>
        </SBox>
      </div>
      <SNote style={{ marginTop: 12 }}>
        downgrading mid-game is OK; upgrading to hardcore mid-game disables existing save's hardcore-only ending unlocks.
      </SNote>
    </div>
  </SBrowser>
);

const Onboard_GuestToAccount = () => (
  <SBrowser w={680} h={460} url="cyoa.game/scene-3">
    <div style={{ padding: 22, height: '100%', background: inkStyles.paper, position: 'relative' }}>
      <div style={{ opacity: 0.35 }}>
        <SBody size={11} color={inkStyles.inkFaint}>chapter the first · turn 3</SBody>
        <SText size={20} weight={700} italic>The Carved Door</SText>
        <SDivider />
        <SBody size={13}>The names on the door shift when you blink. One of them, you realize, is your own…</SBody>
        <SChoice num="1">Press your palm to your name.</SChoice>
        <SChoice num="2">Cover your name with your hand.</SChoice>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(244,236,216,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <SBox filled style={{ padding: 22, width: 320, background: inkStyles.paper }}>
          <SText size={22} weight={700} align="center">Save your tale?</SText>
          <SBody size={12} style={{ textAlign: 'center' }}>
            you've made 3 choices. sign up to keep them — and pick up where you left off, anywhere.
          </SBody>
          <SBox style={{ padding: 6, marginTop: 8 }}><SBody size={12} color={inkStyles.inkFaint} style={{ margin: 0 }}>email</SBody></SBox>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <SBtn primary style={{ flex: 1 }}>save & continue</SBtn>
          </div>
          <SBody size={11} color={inkStyles.inkFaint} style={{ textAlign: 'center', marginTop: 6 }}>
            <u>continue as guest</u> · save expires in 7 days
          </SBody>
        </SBox>
      </div>
      <SNote style={{ position: 'absolute', bottom: 6, left: 18 }}>soft prompt — only after player is hooked.</SNote>
    </div>
  </SBrowser>
);

window.OnboardBoards = {
  Onboard_TutorialFirst,
  Onboard_CharacterCreation,
  Onboard_PromptToScene,
  Onboard_ModePick,
  Onboard_GuestToAccount,
};
