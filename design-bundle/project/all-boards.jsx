
// ===== wireframe-primitives.jsx =====
// Sketchy wireframe primitives — handwritten feel, mostly black ink on aged parchment
// All components are just visual scaffolding for low-fi design exploration.

const inkStyles = {
  ink: '#1a1612',
  inkSoft: '#5a5248',
  inkFaint: '#9b8f7e',
  paper: '#f4ecd8',
  paperDark: '#e8dcc0',
  accent: '#a83232', // deep wax-seal red, used sparingly
  highlight: '#d4a017', // candle glow
};

// Sketchy box — wobbly border via SVG filter
const SBox = ({ children, style, dashed, filled, accent, ...rest }) => (
  <div
    style={{
      border: `1.5px ${dashed ? 'dashed' : 'solid'} ${accent ? inkStyles.accent : inkStyles.ink}`,
      background: filled ? inkStyles.paperDark : 'transparent',
      padding: 10,
      position: 'relative',
      fontFamily: '"Caveat", cursive',
      filter: 'url(#wobble)',
      ...style,
    }}
    {...rest}
  >
    {children}
  </div>
);

// Hand-lettered text
const SText = ({ children, size = 18, style, weight, italic, color, align }) => (
  <span
    style={{
      fontFamily: '"Caveat", cursive',
      fontSize: size,
      fontWeight: weight || 400,
      fontStyle: italic ? 'italic' : 'normal',
      color: color || inkStyles.ink,
      textAlign: align,
      display: align ? 'block' : 'inline',
      lineHeight: 1.15,
      ...style,
    }}
  >
    {children}
  </span>
);

// Body copy in a more legible hand
const SBody = ({ children, size = 15, style, color }) => (
  <p
    style={{
      fontFamily: '"Patrick Hand", cursive',
      fontSize: size,
      color: color || inkStyles.inkSoft,
      lineHeight: 1.45,
      margin: '4px 0',
      ...style,
    }}
  >
    {children}
  </p>
);

// Section title (annotation) over an artboard
const SLabel = ({ children, n, sub }) => (
  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
    {n && (
      <span
        style={{
          fontFamily: '"Caveat", cursive',
          fontSize: 32,
          color: inkStyles.accent,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
    )}
    <span style={{ fontFamily: '"Caveat", cursive', fontSize: 22, color: inkStyles.ink, fontWeight: 700 }}>
      {children}
    </span>
    {sub && (
      <span style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 14, color: inkStyles.inkFaint }}>
        — {sub}
      </span>
    )}
  </div>
);

// Sketchy button
const SBtn = ({ children, w, primary, locked, style }) => (
  <div
    style={{
      border: `1.5px solid ${locked ? inkStyles.inkFaint : inkStyles.ink}`,
      background: primary ? inkStyles.ink : 'transparent',
      color: primary ? inkStyles.paper : locked ? inkStyles.inkFaint : inkStyles.ink,
      padding: '6px 14px',
      borderRadius: 2,
      fontFamily: '"Caveat", cursive',
      fontSize: 17,
      fontWeight: 600,
      width: w,
      display: 'inline-block',
      textAlign: 'center',
      filter: 'url(#wobble)',
      opacity: locked ? 0.6 : 1,
      ...style,
    }}
  >
    {locked && '🔒 '}
    {children}
  </div>
);

// Image placeholder — X through a box
const SImg = ({ w, h, label, style }) => (
  <div
    style={{
      width: w || '100%',
      height: h || 80,
      border: `1.5px solid ${inkStyles.ink}`,
      position: 'relative',
      filter: 'url(#wobble)',
      background: inkStyles.paperDark,
      ...style,
    }}
  >
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, opacity: 0.4 }}
      preserveAspectRatio="none"
    >
      <line x1="0" y1="0" x2="100%" y2="100%" stroke={inkStyles.ink} strokeWidth="1" />
      <line x1="100%" y1="0" x2="0" y2="100%" stroke={inkStyles.ink} strokeWidth="1" />
    </svg>
    {label && (
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"Caveat", cursive',
          fontSize: 14,
          color: inkStyles.inkSoft,
          fontStyle: 'italic',
        }}
      >
        {label}
      </span>
    )}
  </div>
);

// Annotation arrow + note (designer comments on the wireframe)
const SNote = ({ children, style }) => (
  <div
    style={{
      fontFamily: '"Caveat", cursive',
      fontSize: 16,
      color: inkStyles.accent,
      fontStyle: 'italic',
      ...style,
    }}
  >
    ↳ {children}
  </div>
);

// Phone frame (skinny rectangle with notch hint)
const SPhone = ({ children, w = 240, h = 480, style }) => (
  <div
    style={{
      width: w,
      height: h,
      border: `2px solid ${inkStyles.ink}`,
      borderRadius: 24,
      padding: 10,
      position: 'relative',
      filter: 'url(#wobble)',
      background: inkStyles.paper,
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 6,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 50,
        height: 4,
        background: inkStyles.ink,
        borderRadius: 2,
      }}
    />
    <div style={{ marginTop: 12, height: h - 32, overflow: 'hidden' }}>{children}</div>
  </div>
);

// Browser frame
const SBrowser = ({ children, w, h, url, style }) => (
  <div
    style={{
      width: w || '100%',
      border: `2px solid ${inkStyles.ink}`,
      borderRadius: 4,
      filter: 'url(#wobble)',
      background: inkStyles.paper,
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        borderBottom: `1.5px solid ${inkStyles.ink}`,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: inkStyles.paperDark,
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 4, border: `1px solid ${inkStyles.ink}` }} />
      <div style={{ width: 8, height: 8, borderRadius: 4, border: `1px solid ${inkStyles.ink}` }} />
      <div style={{ width: 8, height: 8, borderRadius: 4, border: `1px solid ${inkStyles.ink}` }} />
      <div
        style={{
          flex: 1,
          marginLeft: 10,
          padding: '2px 8px',
          border: `1px solid ${inkStyles.ink}`,
          borderRadius: 2,
          fontFamily: '"Patrick Hand", cursive',
          fontSize: 12,
          color: inkStyles.inkSoft,
        }}
      >
        {url || 'cyoa.game/...'}
      </div>
    </div>
    <div style={{ height: h, overflow: 'hidden' }}>{children}</div>
  </div>
);

// SVG wobble filter — drop once near top of canvas
const WobbleFilter = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      <filter id="wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.2" />
      </filter>
    </defs>
  </svg>
);

// Sketchy divider line
const SDivider = ({ style }) => (
  <div
    style={{
      borderTop: `1.5px solid ${inkStyles.ink}`,
      filter: 'url(#wobble)',
      margin: '8px 0',
      ...style,
    }}
  />
);

// Choice card (used in main reading view)
const SChoice = ({ num, children, locked, hint }) => (
  <div
    style={{
      border: `1.5px solid ${locked ? inkStyles.inkFaint : inkStyles.ink}`,
      padding: '8px 12px',
      marginBottom: 6,
      filter: 'url(#wobble)',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      opacity: locked ? 0.55 : 1,
    }}
  >
    <span
      style={{
        fontFamily: '"Caveat", cursive',
        fontSize: 22,
        fontWeight: 700,
        color: inkStyles.accent,
        minWidth: 18,
      }}
    >
      {num}.
    </span>
    <div style={{ flex: 1 }}>
      <span style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 15, color: inkStyles.ink }}>
        {locked && '🔒 '}
        {children}
      </span>
      {hint && (
        <div
          style={{
            fontFamily: '"Caveat", cursive',
            fontSize: 13,
            color: inkStyles.inkFaint,
            fontStyle: 'italic',
            marginTop: 2,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  </div>
);

Object.assign(window, {
  inkStyles,
  SBox,
  SText,
  SBody,
  SLabel,
  SBtn,
  SImg,
  SNote,
  SPhone,
  SBrowser,
  WobbleFilter,
  SDivider,
  SChoice,
});


// ===== boards-1.jsx =====
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


// ===== boards-2.jsx =====
// Wireframe artboards — Part 2: Reading view variations + Stats HUD modes

// ────────────────────────────────────────────────────────────────────────
// READING VIEW — the core surface, 5 variations
// ────────────────────────────────────────────────────────────────────────

const SAMPLE_PROSE = `The cathedral has not been used as a cathedral in three hundred years, but the bones of saints still hum beneath the floor when you walk over them. You stop at the chancel. A single candle is lit, though no one tends it. The air smells of wax and old rain.

A figure in grey watches from the choir stalls. They have not moved since you entered.`;

const StatBar = ({ compact }) => (
  <div style={{ display: 'flex', gap: compact ? 8 : 14, alignItems: 'center', fontFamily: '"Caveat", cursive', fontSize: compact ? 14 : 16 }}>
    <span>♥ 18/20</span>
    <span>◈ 47g</span>
    <span style={{ color: inkStyles.accent }}>✦ 3 items</span>
    <span style={{ color: inkStyles.inkFaint }}>turn 12</span>
  </div>
);

// V1 — Like a book: centered column, generous margins, paged
const Read_Book = () => (
  <SBrowser w={760} h={540} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column' }}>
      {/* top chrome */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 18px', borderBottom: `1px solid ${inkStyles.inkFaint}` }}>
        <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>Bone Cathedral · ch. 4</SBody>
        <StatBar compact />
        <div style={{ display: 'flex', gap: 4 }}>
          <SBtn>⌫</SBtn>
          <SBtn>≡</SBtn>
        </div>
      </div>
      {/* page */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px 0' }}>
        <div style={{ width: 460 }}>
          <SBody size={11} color={inkStyles.inkFaint} style={{ textAlign: 'center', margin: 0 }}>— XII —</SBody>
          <SText size={22} weight={700} italic align="center">The Watcher in Grey</SText>
          <SDivider />
          <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 15, lineHeight: 1.6, color: inkStyles.ink, textAlign: 'justify' }}>
            {SAMPLE_PROSE}
          </p>
          <SDivider />
          <SChoice num="1">Approach the figure.</SChoice>
          <SChoice num="2">Genuflect at the chancel.</SChoice>
          <SChoice num="3" locked hint="needs the Cathedral Key">Try the door behind the altar.</SChoice>
        </div>
      </div>
      <SNote style={{ padding: '4px 18px' }}>generous margins, no scroll within a page. ⌫ = rewind one step (story mode only).</SNote>
    </div>
  </SBrowser>
);

// V2 — Modern app: sticky stat bar, scroll, choice cards float at bottom
const Read_ModernApp = () => (
  <SBrowser w={760} h={540} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, display: 'flex', flexDirection: 'column' }}>
      {/* sticky stat hud */}
      <div style={{ background: inkStyles.paperDark, padding: '10px 16px', borderBottom: `1.5px solid ${inkStyles.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <SText size={16} weight={700}>Wren of Ashbourne</SText>
          <SBody size={10} color={inkStyles.inkFaint} style={{ margin: 0 }}>Bone Cathedral · turn 12</SBody>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div><SBody size={10} style={{ margin: 0 }}>♥ vitality</SBody><SText size={18} weight={700}>18/20</SText></div>
          <div><SBody size={10} style={{ margin: 0 }}>◈ gold</SBody><SText size={18} weight={700}>47</SText></div>
          <div><SBody size={10} style={{ margin: 0 }}>✦ items</SBody><SText size={18} weight={700}>3</SText></div>
        </div>
      </div>
      {/* prose scroll area */}
      <div style={{ flex: 1, padding: '18px 22px', overflow: 'hidden' }}>
        <SText size={20} weight={700} italic>The Watcher in Grey</SText>
        <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 14, lineHeight: 1.55, color: inkStyles.ink }}>{SAMPLE_PROSE}</p>
      </div>
      {/* choice tray */}
      <div style={{ borderTop: `1.5px solid ${inkStyles.ink}`, padding: 12, background: inkStyles.paperDark }}>
        <SBody size={10} color={inkStyles.inkFaint} style={{ margin: '0 0 4px' }}>what do you do?</SBody>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <SChoice num="1">Approach the figure.</SChoice>
          <SChoice num="2">Genuflect at the chancel.</SChoice>
          <SChoice num="3" locked hint="needs Cathedral Key">Try the door behind altar.</SChoice>
          <SChoice num="4" hint="risky">Speak to the candle.</SChoice>
        </div>
      </div>
      <SNote style={{ padding: '4px 16px', background: inkStyles.paperDark }}>app feel — closest to Expo/native port. choices always in thumb reach.</SNote>
    </div>
  </SBrowser>
);

// V3 — Graphic novel: text panel over background image
const Read_GraphicNovel = () => (
  <SBrowser w={760} h={540} url="cyoa.game/read">
    <div style={{ height: '100%', position: 'relative', background: inkStyles.paperDark }}>
      <SImg w="100%" h="100%" label="full-bleed scene illustration (Pro tier)" style={{ position: 'absolute', inset: 0, border: 'none' }} />
      <div style={{ position: 'absolute', top: 12, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
        <SBox filled style={{ padding: '4px 8px', background: 'rgba(244,236,216,0.85)' }}>
          <StatBar compact />
        </SBox>
        <SBtn>≡</SBtn>
      </div>
      {/* prose card overlay */}
      <div style={{ position: 'absolute', bottom: 100, left: '12%', right: '12%' }}>
        <SBox filled style={{ padding: 16, background: 'rgba(244,236,216,0.95)' }}>
          <SText size={18} weight={700} italic>The Watcher in Grey</SText>
          <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 13, lineHeight: 1.5, color: inkStyles.ink, margin: 0 }}>
            {SAMPLE_PROSE.split('\n\n')[0]}
          </p>
        </SBox>
      </div>
      {/* choice strip */}
      <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16, display: 'flex', gap: 6 }}>
        {['Approach', 'Genuflect', '🔒 try door', 'Speak to candle'].map((t, i) => (
          <SBox key={i} filled style={{ flex: 1, padding: '8px 6px', textAlign: 'center', background: 'rgba(244,236,216,0.92)' }}>
            <SText size={14} weight={700}>{i + 1}. {t}</SText>
          </SBox>
        ))}
      </div>
      <SNote style={{ position: 'absolute', bottom: -22, left: 16, color: inkStyles.accent }}>Pro-tier: every scene illustrated. text overlay can be hidden for cinematic.</SNote>
    </div>
  </SBrowser>
);

// V4 — Terminal/journal: typewriter prose, monospace feel inside diary
const Read_Journal = () => (
  <SBrowser w={760} h={540} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 18, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>~/journal/wren · entry 12</SBody>
        <StatBar compact />
      </div>
      <SDivider />
      <div style={{ flex: 1, fontFamily: '"Patrick Hand", cursive', fontSize: 14, color: inkStyles.ink, lineHeight: 1.6 }}>
        <span style={{ color: inkStyles.inkFaint }}>$</span> entered: <em>Bone Cathedral, chancel</em><br />
        <span style={{ color: inkStyles.inkFaint }}>·</span> {SAMPLE_PROSE.split('\n\n')[0]}<br />
        <span style={{ color: inkStyles.inkFaint }}>·</span> {SAMPLE_PROSE.split('\n\n')[1]}<span style={{ borderLeft: `2px solid ${inkStyles.ink}`, marginLeft: 2 }}>&nbsp;</span>
      </div>
      <SDivider />
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: '0 0 4px' }}>&gt; choose:</SBody>
      <SChoice num="1">approach the figure</SChoice>
      <SChoice num="2">genuflect</SChoice>
      <SChoice num="3" locked hint="needs key">try door behind altar</SChoice>
      <SNote>typewriter typing on each scene reveal. great for keyboard players & cosmic-horror tones.</SNote>
    </div>
  </SBrowser>
);

// V5 — Mobile reading view (the Expo target)
const Read_Mobile = () => (
  <SPhone>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* top stat strip */}
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${inkStyles.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SBody size={10} style={{ margin: 0 }}>♥18 · ◈47 · ✦3</SBody>
        <SBtn style={{ padding: '2px 6px', fontSize: 12 }}>≡</SBtn>
      </div>
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <SText size={16} weight={700} italic>Watcher in Grey</SText>
        <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 12, lineHeight: 1.5, color: inkStyles.ink, margin: '4px 0' }}>
          {SAMPLE_PROSE}
        </p>
      </div>
      <div style={{ padding: 8, borderTop: `1px solid ${inkStyles.ink}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SChoice num="1">Approach the figure.</SChoice>
        <SChoice num="2">Genuflect.</SChoice>
        <SChoice num="3" locked>Door behind altar.</SChoice>
      </div>
    </div>
  </SPhone>
);

window.ReadBoards = { Read_Book, Read_ModernApp, Read_GraphicNovel, Read_Journal, Read_Mobile };

// ────────────────────────────────────────────────────────────────────────
// STATS HUD MODES — how prominent the stats are
// ────────────────────────────────────────────────────────────────────────

const Stats_Persistent = () => (
  <SBox style={{ width: 380, padding: 14, background: inkStyles.paperDark }}>
    <SText size={16} weight={700}>1 · Always-visible HUD</SText>
    <SBody size={11} color={inkStyles.inkFaint}>top strip, never hides. game-iest.</SBody>
    <SBox style={{ marginTop: 8, padding: 8, background: inkStyles.paper }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SText size={14} weight={700}>Wren</SText>
        <div style={{ display: 'flex', gap: 10, fontFamily: '"Caveat", cursive', fontSize: 15 }}>
          <span>♥ 18/20</span><span>◈ 47</span><span>✦ 3</span>
        </div>
      </div>
      <SDivider style={{ margin: '6px 0' }} />
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>… story below …</SBody>
    </SBox>
    <SNote style={{ marginTop: 6 }}>best for survival/hardcore. breaks the "book" feel slightly.</SNote>
  </SBox>
);

const Stats_PeekDrawer = () => (
  <SBox style={{ width: 380, padding: 14, background: inkStyles.paperDark }}>
    <SText size={16} weight={700}>2 · Peek drawer</SText>
    <SBody size={11} color={inkStyles.inkFaint}>tap a corner sigil; drawer slides in.</SBody>
    <SBox style={{ marginTop: 8, padding: 8, background: inkStyles.paper, position: 'relative', minHeight: 90 }}>
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>… story flows uninterrupted …</SBody>
      <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
        <SBox style={{ padding: 2, background: inkStyles.paperDark }}><SText size={12}>♥18 ◈47</SText></SBox>
      </div>
      <div style={{ position: 'absolute', right: 0, top: 28, bottom: 0, width: 110, background: inkStyles.paperDark, borderLeft: `1.5px solid ${inkStyles.ink}`, padding: 6 }}>
        <SBody size={10} style={{ margin: 0 }}>♥ 18/20</SBody>
        <SBody size={10} style={{ margin: 0 }}>◈ 47 gold</SBody>
        <SBody size={10} style={{ margin: 0 }}>✦ rusty key</SBody>
        <SBody size={10} style={{ margin: 0 }}>✦ candle stub</SBody>
        <SBody size={10} style={{ margin: 0 }}>✦ vellum scrap</SBody>
      </div>
    </SBox>
    <SNote style={{ marginTop: 6 }}>best balance — preserves "book" feel, full info on demand.</SNote>
  </SBox>
);

const Stats_Contextual = () => (
  <SBox style={{ width: 380, padding: 14, background: inkStyles.paperDark }}>
    <SText size={16} weight={700}>3 · Contextual surfacing</SText>
    <SBody size={11} color={inkStyles.inkFaint}>only appears when something changes.</SBody>
    <SBox style={{ marginTop: 8, padding: 8, background: inkStyles.paper, position: 'relative' }}>
      <SBody size={11} style={{ margin: 0 }}>The poison takes hold…</SBody>
      <div style={{ marginTop: 6, padding: 6, border: `1.5px solid ${inkStyles.accent}`, display: 'inline-block', filter: 'url(#wobble)' }}>
        <SText size={14} weight={700} color={inkStyles.accent}>♥ −5 vitality (now 13/20)</SText>
      </div>
      <SBody size={10} color={inkStyles.inkFaint} style={{ margin: '6px 0 0' }}>↳ pip fades after 3s. tap ≡ to see all.</SBody>
    </SBox>
    <SNote style={{ marginTop: 6 }}>most book-like. risk: hardcore players miss critical state.</SNote>
  </SBox>
);

const Stats_FullSheet = () => (
  <SBox style={{ width: 380, padding: 14, background: inkStyles.paperDark }}>
    <SText size={16} weight={700}>4 · The Character Sheet</SText>
    <SBody size={11} color={inkStyles.inkFaint}>full pause overlay — RPG menu.</SBody>
    <SBox style={{ marginTop: 8, padding: 10, background: inkStyles.paper }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <SText size={14} weight={700}>Wren of Ashbourne</SText>
          <SBody size={10} style={{ margin: 0 }}>The Scholar · turn 12</SBody>
          <SDivider style={{ margin: '4px 0' }} />
          <SBody size={11} style={{ margin: 0 }}>♥ vitality 18/20</SBody>
          <SBody size={11} style={{ margin: 0 }}>◈ gold 47</SBody>
          <SBody size={11} style={{ margin: 0 }}>⚜ wisdom 6 (hidden)</SBody>
        </div>
        <div>
          <SBody size={11} style={{ margin: 0, fontWeight: 700 }}>inventory</SBody>
          <SBody size={10} style={{ margin: 0 }}>· rusty key</SBody>
          <SBody size={10} style={{ margin: 0 }}>· candle stub</SBody>
          <SBody size={10} style={{ margin: 0 }}>· vellum scrap</SBody>
          <SBody size={11} style={{ margin: '6px 0 0', fontWeight: 700 }}>tags</SBody>
          <SBody size={10} style={{ margin: 0 }}>met_queen · betrayed_thieves</SBody>
        </div>
      </div>
    </SBox>
    <SNote style={{ marginTop: 6 }}>opens on demand from any reading view. lives behind ≡.</SNote>
  </SBox>
);

window.StatsBoards = { Stats_Persistent, Stats_PeekDrawer, Stats_Contextual, Stats_FullSheet };


// ===== boards-3.jsx =====
// Wireframe artboards — Part 3: Death, Endings map, Co-op, Paywall, Settings

// ────────────────────────────────────────────────────────────────────────
// DEATH SCREEN — brutal, dramatic, final
// ────────────────────────────────────────────────────────────────────────

const Death_Brutal = () => (
  <SBrowser w={680} h={460} url="cyoa.game/end">
    <div style={{ height: '100%', background: '#0a0805', color: inkStyles.paper, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, position: 'relative' }}>
      <SText size={72} weight={700} color={inkStyles.accent} italic>You died.</SText>
      <SDivider style={{ borderColor: inkStyles.paper, width: 200 }} />
      <SBody size={14} color={inkStyles.paper} style={{ textAlign: 'center', maxWidth: 380 }}>
        The watcher in grey was, of course, not a watcher at all.<br />
        Your tale ends in the chancel of the Bone Cathedral, on turn 12.
      </SBody>
      <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 14 }}>
        ENDING #7 unlocked: <em>"The Communicant"</em>
      </SBody>
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <SBtn primary style={{ background: inkStyles.accent, borderColor: inkStyles.accent }}>begin again</SBtn>
        <SBtn style={{ borderColor: inkStyles.paper, color: inkStyles.paper }}>see the map</SBtn>
      </div>
      <SBody size={11} color={inkStyles.inkFaint} style={{ position: 'absolute', bottom: 14 }}>
        hardcore mode · save purged
      </SBody>
    </div>
  </SBrowser>
);

const Death_Bookish = () => (
  <SBrowser w={680} h={460} url="cyoa.game/end">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>— FINIS —</SBody>
      <SText size={48} weight={700} italic>And so the tale ended.</SText>
      <SDivider style={{ width: 240 }} />
      <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 14, lineHeight: 1.6, color: inkStyles.ink, textAlign: 'center', maxWidth: 420 }}>
        Wren of Ashbourne was buried beneath the chancel, where the bones of saints
        still hum. Some say her name appears now on the carved door. Some say it has
        always been there.
      </p>
      <SDivider style={{ width: 240 }} />
      <SBody size={11} color={inkStyles.inkFaint}>turn 12 · 4 choices made · 1 of 23 endings</SBody>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <SBtn primary>start anew</SBtn>
        <SBtn>share this ending</SBtn>
        <SBtn>endings map</SBtn>
      </div>
    </div>
  </SBrowser>
);

const Death_Cinematic = () => (
  <SBrowser w={680} h={460} url="cyoa.game/end">
    <div style={{ height: '100%', position: 'relative', background: '#0a0805' }}>
      <SImg w="100%" h="100%" label="final scene illustration — pro tier" style={{ position: 'absolute', inset: 0, border: 'none', opacity: 0.5 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, #0a0805 30%, transparent)' }} />
      <div style={{ position: 'absolute', bottom: 30, left: 30, right: 30 }}>
        <SBody size={11} color={inkStyles.accent}>YOU DIED · turn 12</SBody>
        <SText size={36} weight={700} color={inkStyles.paper} italic>The Communicant</SText>
        <SBody size={13} color={inkStyles.paper}>
          a previously-undiscovered ending. share it before someone else does.
        </SBody>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <SBtn primary style={{ background: inkStyles.accent, borderColor: inkStyles.accent }}>share</SBtn>
          <SBtn style={{ borderColor: inkStyles.paper, color: inkStyles.paper }}>begin again</SBtn>
        </div>
      </div>
      <SNote style={{ position: 'absolute', top: 12, left: 12, color: inkStyles.highlight }}>"first to find" — viral hook</SNote>
    </div>
  </SBrowser>
);

window.DeathBoards = { Death_Brutal, Death_Bookish, Death_Cinematic };

// ────────────────────────────────────────────────────────────────────────
// ENDINGS MAP — branching web of paths taken
// ────────────────────────────────────────────────────────────────────────

const Node = ({ x, y, label, found, current, locked, ending }) => (
  <g>
    <circle cx={x} cy={y} r={ending ? 14 : 9}
      fill={current ? inkStyles.accent : found ? inkStyles.ink : 'transparent'}
      stroke={locked ? inkStyles.inkFaint : inkStyles.ink} strokeWidth="1.5"
      strokeDasharray={locked ? '3 2' : 'none'} />
    {ending && <circle cx={x} cy={y} r={18} fill="none" stroke={inkStyles.ink} strokeWidth="1" />}
    <text x={x + 18} y={y + 4} fontFamily="Caveat, cursive" fontSize="12" fill={locked ? inkStyles.inkFaint : inkStyles.ink}>
      {label}
    </text>
  </g>
);

const Endings_Web = () => (
  <SBrowser w={760} h={520} url="cyoa.game/map">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <SText size={20} weight={700}>The Map of What-Might-Have-Been</SText>
        <SBody size={11} color={inkStyles.inkFaint}>7 of 23 endings · 41% explored</SBody>
      </div>
      <SBox style={{ marginTop: 8, padding: 0, height: 380, position: 'relative', background: inkStyles.paperDark }}>
        <svg viewBox="0 0 720 380" style={{ width: '100%', height: '100%' }}>
          <g stroke={inkStyles.ink} strokeWidth="1.5" fill="none" filter="url(#wobble)">
            <path d="M 60 190 Q 130 140 200 140" />
            <path d="M 60 190 Q 130 240 200 240" />
            <path d="M 200 140 Q 280 100 360 90" />
            <path d="M 200 140 Q 280 170 360 170" />
            <path d="M 200 240 Q 280 240 360 240" />
            <path d="M 200 240 Q 280 290 360 310" strokeDasharray="3 3" stroke={inkStyles.inkFaint} />
            <path d="M 360 90 Q 460 70 560 70" />
            <path d="M 360 170 Q 460 170 560 170" strokeDasharray="3 3" stroke={inkStyles.inkFaint} />
            <path d="M 360 240 Q 460 240 560 240" />
            <path d="M 360 310 Q 460 320 560 320" strokeDasharray="3 3" stroke={inkStyles.inkFaint} />
          </g>
          <Node x={60} y={190} label="begin" found />
          <Node x={200} y={140} label="iron door" found />
          <Node x={200} y={240} label="carved door" found current />
          <Node x={360} y={90} label="the queen" found />
          <Node x={360} y={170} label="?" locked />
          <Node x={360} y={240} label="watcher" found current />
          <Node x={360} y={310} label="?" locked />
          <Node x={560} y={70} label="The Crowned" found ending />
          <Node x={560} y={170} label="???" locked ending />
          <Node x={560} y={240} label="The Communicant" found ending />
          <Node x={560} y={320} label="???" locked ending />
        </svg>
      </SBox>
      <div style={{ marginTop: 6, display: 'flex', gap: 14, fontFamily: '"Patrick Hand", cursive', fontSize: 11, color: inkStyles.inkSoft }}>
        <span>● path taken</span>
        <span style={{ color: inkStyles.accent }}>● this run</span>
        <span>○ ending</span>
        <span style={{ color: inkStyles.inkFaint }}>⋯ unexplored</span>
      </div>
      <SNote>tap any node to read what you wrote there. tap ??? = seed a new run from that branch.</SNote>
    </div>
  </SBrowser>
);

const Endings_TrophyRoom = () => (
  <SBrowser w={760} h={520} url="cyoa.game/endings">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 18 }}>
      <SText size={20} weight={700}>The Crypt of Endings</SText>
      <SBody size={11} color={inkStyles.inkFaint}>7 of 23 found across all your tales</SBody>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { t: 'The Crowned', s: 'iron door · turn 18' },
          { t: 'The Communicant', s: 'chancel · turn 12', new: true },
          { t: 'The Forsworn', s: 'thieves\' den · turn 9' },
          { t: 'The Stranger', s: 'painted door · turn 3' },
          { t: '???', s: 'something with the queen', locked: true },
          { t: '???', s: 'a tale of fire', locked: true },
          { t: '???', s: 'requires hardcore', locked: true },
          { t: '+ 16 more', s: '', locked: true },
        ].map((e, i) => (
          <SBox key={i} style={{ padding: 10, opacity: e.locked ? 0.55 : 1 }} accent={e.new}>
            <SImg h={70} label={e.locked ? '?' : ''} />
            <SText size={14} weight={700} style={{ display: 'block', marginTop: 4 }}>{e.t}</SText>
            <SBody size={10} style={{ margin: 0 }}>{e.s}</SBody>
            {e.new && <SBody size={10} color={inkStyles.accent} style={{ margin: 0 }}>★ NEW</SBody>}
          </SBox>
        ))}
      </div>
      <SNote>cards become illustrated when unlocked (Pro tier). great for sharing/screenshots.</SNote>
    </div>
  </SBrowser>
);

window.EndingBoards = { Endings_Web, Endings_TrophyRoom };

// ────────────────────────────────────────────────────────────────────────
// CO-OP / PASS-THE-CONTROLLER
// ────────────────────────────────────────────────────────────────────────

const Coop_PassDevice = () => (
  <SBrowser w={680} h={460} url="cyoa.game/together">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 22 }}>
      <SText size={20} weight={700}>Around the Fire</SText>
      <SBody size={12}>two or more readers, one device. take turns choosing.</SBody>
      <SBox style={{ marginTop: 10, padding: 12 }}>
        <SBody size={12} style={{ margin: 0 }}>readers</SBody>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {['Wren', 'Marcus', 'Ada', '+ add'].map((n, i) => (
            <SBox key={i} filled={i < 3} style={{ padding: '4px 10px' }}>
              <SText size={14}>{i < 3 ? `● ${n}` : n}</SText>
            </SBox>
          ))}
        </div>
        <SBody size={11} color={inkStyles.inkFaint} style={{ marginTop: 8 }}>turn order: rotating · Wren chooses first</SBody>
      </SBox>
      <SBox style={{ marginTop: 10, padding: 12 }}>
        <SBody size={12} style={{ margin: 0, fontWeight: 700 }}>turn rules</SBody>
        <SBody size={11} style={{ margin: '4px 0' }}>○ rotate every choice · ● rotate every scene · ○ majority vote on each choice</SBody>
        <SBody size={11} color={inkStyles.inkFaint}>vote mode shows all readers' picks before resolving.</SBody>
      </SBox>
      <SBtn primary style={{ marginTop: 12 }}>begin together</SBtn>
      <SNote>solo-mode UI, lightly enriched. no accounts needed for the others.</SNote>
    </div>
  </SBrowser>
);

const Coop_TurnIndicator = () => (
  <SBrowser w={680} h={460} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 18, position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SBox filled style={{ padding: '4px 12px', background: inkStyles.ink }}>
          <SText size={16} weight={700} color={inkStyles.paper}>↳ Marcus's turn</SText>
        </SBox>
        <SBody size={11} color={inkStyles.inkFaint}>turn 12 · pass when done</SBody>
      </div>
      <SDivider />
      <SText size={18} weight={700} italic>The Watcher in Grey</SText>
      <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 13, lineHeight: 1.55 }}>
        {SAMPLE_PROSE.split('\n\n')[0]}
      </p>
      <SDivider />
      <SChoice num="1">Approach the figure.</SChoice>
      <SChoice num="2">Genuflect at the chancel.</SChoice>
      <SChoice num="3" locked hint="Marcus doesn't have the key">Try the door behind altar.</SChoice>
      <div style={{ position: 'absolute', bottom: 14, right: 14 }}>
        <SBtn primary>↳ pass to Ada</SBtn>
      </div>
    </div>
  </SBrowser>
);

const Coop_VoteMode = () => (
  <SBrowser w={680} h={460} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 18 }}>
      <SBody size={11} color={inkStyles.inkFaint}>vote mode · 3 readers</SBody>
      <SText size={18} weight={700} italic>The Watcher in Grey</SText>
      <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 13, lineHeight: 1.5 }}>{SAMPLE_PROSE.split('\n\n')[0]}</p>
      <SDivider />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SBox style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SText size={14}>1. Approach the figure.</SText>
          <SBody size={11} style={{ margin: 0 }}>Wren · Ada · ●●</SBody>
        </SBox>
        <SBox accent filled style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SText size={14} weight={700}>2. Genuflect at the chancel.</SText>
          <SBody size={11} style={{ margin: 0, color: inkStyles.accent }}>Marcus · ●</SBody>
        </SBox>
        <SBox style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SText size={14}>3. Speak to the candle.</SText>
          <SBody size={11} style={{ margin: 0 }}>—</SBody>
        </SBox>
      </div>
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SBody size={11} color={inkStyles.inkFaint}>2 of 3 voted · waiting on Ada</SBody>
        <SBtn primary>resolve now</SBtn>
      </div>
      <SNote>future: same UI works for remote co-op via shareable room link.</SNote>
    </div>
  </SBrowser>
);

window.CoopBoards = { Coop_PassDevice, Coop_TurnIndicator, Coop_VoteMode };

// ────────────────────────────────────────────────────────────────────────
// PAYWALL / TURN LIMIT
// ────────────────────────────────────────────────────────────────────────

const Paywall_TurnLimit = () => (
  <SBrowser w={680} h={460} url="cyoa.game/read">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 22, position: 'relative' }}>
      <div style={{ opacity: 0.3 }}>
        <SText size={18} weight={700} italic>The Watcher in Grey</SText>
        <p style={{ fontFamily: '"Patrick Hand", cursive', fontSize: 13 }}>{SAMPLE_PROSE.split('\n\n')[0]}</p>
        <SChoice num="1">Approach the figure.</SChoice>
        <SChoice num="2">Genuflect.</SChoice>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(244,236,216,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <SBox style={{ padding: 22, background: inkStyles.paper, width: 400 }}>
          <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>the candle gutters…</SBody>
          <SText size={26} weight={700}>You've reached today's turn.</SText>
          <SBody size={12}>5 of 5 turns used. the book closes itself until tomorrow — or:</SBody>
          <div style={{ marginTop: 10 }}>
            <SBox accent style={{ padding: 10 }}>
              <SText size={16} weight={700} color={inkStyles.accent}>★ Unlimited — $5/mo</SText>
              <SBody size={11} style={{ margin: 0 }}>read as long as you like. cancel anytime.</SBody>
            </SBox>
            <SBox style={{ padding: 10, marginTop: 6 }}>
              <SText size={16} weight={700}>✦ Pro — $9/mo</SText>
              <SBody size={11} style={{ margin: 0 }}>+ illustrations · ambient sound · early endings</SBody>
            </SBox>
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SBody size={11} color={inkStyles.inkFaint} style={{ margin: 0 }}>resets in 7h 22m</SBody>
            <SBtn primary>subscribe</SBtn>
          </div>
        </SBox>
      </div>
    </div>
  </SBrowser>
);

const Paywall_PreRead = () => (
  <SBox style={{ width: 380, padding: 16 }}>
    <SText size={16} weight={700}>2 · ambient (turn counter visible always)</SText>
    <SBody size={11} color={inkStyles.inkFaint}>show usage in the HUD; never blocks mid-scene without warning.</SBody>
    <SBox style={{ marginTop: 8, padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <SText size={14} weight={700}>Wren</SText>
        <SBox style={{ padding: '2px 8px' }}>
          <SText size={12}>turns 3/5 today · <span style={{ color: inkStyles.accent }}>upgrade</span></SText>
        </SBox>
      </div>
      <SBody size={11} color={inkStyles.inkFaint} style={{ margin: '6px 0 0' }}>at turn 4: gentle inline nudge. at turn 5: blocking modal.</SBody>
    </SBox>
    <SNote>respects flow. no surprise paywall.</SNote>
  </SBox>
);

const Paywall_ProUpsell = () => (
  <SBox style={{ width: 380, padding: 16 }}>
    <SText size={16} weight={700}>3 · pro upsell at scene reveal</SText>
    <SBody size={11} color={inkStyles.inkFaint}>"see this scene illustrated?" → contextual.</SBody>
    <SBox style={{ marginTop: 8, padding: 8, position: 'relative' }}>
      <SImg h={90} label="blurred preview illustration" />
      <SBox accent filled style={{ position: 'absolute', bottom: 14, left: 14, padding: '4px 8px' }}>
        <SText size={13} weight={700} color={inkStyles.accent}>✦ illustrate this scene → Pro</SText>
      </SBox>
    </SBox>
    <SNote>shown ~ once per chapter. dismissible.</SNote>
  </SBox>
);

window.PaywallBoards = { Paywall_TurnLimit, Paywall_PreRead, Paywall_ProUpsell };

// ────────────────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────────────────

const SettingsPanel = () => (
  <SBrowser w={680} h={460} url="cyoa.game/settings">
    <div style={{ height: '100%', background: inkStyles.paper, padding: 22 }}>
      <SText size={20} weight={700}>Reader's Preferences</SText>
      <SDivider />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <SBody size={12} style={{ fontWeight: 700, margin: 0 }}>theme</SBody>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {['Day', 'Night', 'Sepia'].map((t) => (
              <SBox key={t} filled={t === 'Sepia'} style={{ padding: '4px 10px' }}>
                <SText size={14}>{t}</SText>
              </SBox>
            ))}
          </div>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>typeface</SBody>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <SBox style={{ padding: '4px 10px' }}><span style={{ fontFamily: 'serif', fontSize: 14 }}>Serif</span></SBox>
            <SBox filled style={{ padding: '4px 10px' }}><span style={{ fontFamily: 'sans-serif', fontSize: 14 }}>Sans</span></SBox>
            <SBox style={{ padding: '4px 10px' }}><span style={{ fontFamily: 'monospace', fontSize: 14 }}>Mono</span></SBox>
          </div>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>text size</SBody>
          <SBox style={{ padding: 6, marginTop: 4 }}><SText size={14}>A — — ● — — A+</SText></SBox>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>reading layout</SBody>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {['book', 'app', 'graphic novel', 'journal'].map((t) => (
              <SBox key={t} filled={t === 'book'} style={{ padding: '4px 8px' }}>
                <SText size={13}>{t}</SText>
              </SBox>
            ))}
          </div>
        </div>
        <div>
          <SBody size={12} style={{ fontWeight: 700, margin: 0 }}>stats visibility</SBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {['always visible', 'peek drawer (default)', 'contextual only', 'sheet on demand'].map((t, i) => (
              <SBox key={t} filled={i === 1} style={{ padding: 6 }}><SText size={13}>{t}</SText></SBox>
            ))}
          </div>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>ambient sound</SBody>
          <SBox style={{ padding: 6 }}><SText size={13}>● on (Pro) — candle hum, distant rain</SText></SBox>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>game mode</SBody>
          <SBox style={{ padding: 6 }}><SText size={13}>📖 story · ⚠ switch to hardcore?</SText></SBox>
          <SBody size={12} style={{ fontWeight: 700, marginTop: 12 }}>account</SBody>
          <SBody size={11} style={{ margin: 0 }}>wren@example · subscribed (Pro)</SBody>
          <SBody size={11} color={inkStyles.inkFaint}>· export saves · · sign out · ✕ delete account</SBody>
        </div>
      </div>
    </div>
  </SBrowser>
);

window.SettingsBoards = { SettingsPanel };

