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
