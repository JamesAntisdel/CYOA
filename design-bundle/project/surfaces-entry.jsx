// Landing / cover screen — 4 variants
// Goal: someone hits the URL cold. What hooks them?

const LandingClassic = () => (
  <div className="wf full col p-6 items-center" style={{ justifyContent: 'space-between' }}>
    <div className="row full justify-between" style={{ fontSize: 11, fontFamily: 'Special Elite, monospace' }}>
      <span>UNTITLED · A LIVING TOME</span>
      <span>v 0 · 1</span>
    </div>
    <div className="col items-center gap-3 text-center" style={{ marginTop: -20 }}>
      <Flourish />
      <div className="wf-classic" style={{ fontSize: 38, lineHeight: 1, fontStyle: 'italic' }}>
        The <Scribble>Endless</Scribble> Tome
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink-soft)', maxWidth: 280 }}>
        an ever-shifting tale, written for you alone — by candle &amp; by code.
      </div>
      <Img label="cover · gothic illustration" w={220} h={130} style={{ marginTop: 10 }} />
    </div>
    <div className="col gap-2 items-center" style={{ width: '100%' }}>
      <Btn variant="primary" style={{ width: 220 }}>open the book</Btn>
      <Btn variant="ghost" style={{ width: 220 }}>continue · last chapter 3</Btn>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
        guest · sign in to keep your tale
      </div>
    </div>
    <Note style={{ top: 70, right: 10, width: 90, transform: 'rotate(4deg)' }}>
      title can be the<br/>active story name
    </Note>
  </div>
);

const LandingFullbleed = () => (
  <div className="wf full relative">
    <Img label="full bleed atmosphere · candle, fog, doorway" w="100%" h="100%" style={{ borderRadius: 0 }} />
    <div className="absolute" style={{ inset: 0, background: 'linear-gradient(to bottom, rgba(26,20,16,0) 30%, rgba(26,20,16,0.85) 100%)' }} />
    <div className="absolute col gap-3" style={{ left: 24, right: 24, bottom: 28, color: 'var(--paper)' }}>
      <div className="wf-typed" style={{ fontSize: 10, letterSpacing: '0.2em', opacity: 0.7 }}>CHAPTER ZERO · THE THRESHOLD</div>
      <div className="wf-classic" style={{ fontSize: 30, lineHeight: 1.1, fontStyle: 'italic' }}>
        you wake in a room<br/>that was not there yesterday.
      </div>
      <div className="row gap-2" style={{ marginTop: 4 }}>
        <Btn variant="primary" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>begin →</Btn>
        <Btn style={{ background: 'transparent', color: 'var(--paper)', borderColor: 'var(--paper)' }}>i have an account</Btn>
      </div>
    </div>
    <Note style={{ top: 12, left: 12, color: 'var(--candle)' }}>opens straight<br/>into prologue feel</Note>
  </div>
);

const LandingPicker = () => (
  <div className="wf full col p-6 gap-3">
    <div className="row justify-between items-center">
      <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic' }}>The Tome</div>
      <div className="row gap-2" style={{ fontSize: 12 }}>
        <span style={{ color: 'var(--ink-faint)' }}>guest</span>
        <Btn>sign in</Btn>
      </div>
    </div>
    <Divider />
    <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>choose your first tale</div>
    <div className="col gap-3 flex-1">
      {[
        { tag: 'TUTORIAL', title: 'Escape the Training Room', sub: '~10 min · learn the basics', img: 'cell door' },
        { tag: 'STARTER', title: 'The Heir of Ash', sub: 'gothic · 30+ endings', img: 'a cracked crown' },
        { tag: 'STARTER', title: 'Innkeeper at World\'s End', sub: 'cozy mystery · cards & coin', img: 'lantern in fog' },
      ].map((s, i) => (
        <div key={i} className="wf-box row gap-3 p-3 items-center" style={{ background: 'var(--paper)' }}>
          <Img label={s.img} w={70} h={70} />
          <div className="col flex-1 gap-1">
            <div className="wf-typed" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--candle)' }}>{s.tag}</div>
            <div className="wf-classic" style={{ fontSize: 20, fontStyle: 'italic', lineHeight: 1 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{s.sub}</div>
          </div>
          <Btn variant="primary">→</Btn>
        </div>
      ))}
    </div>
    <Btn variant="ghost" style={{ borderStyle: 'dashed' }}>＋ generate a new tale (AI)</Btn>
    <Note style={{ top: 80, right: 8, width: 120, transform: 'rotate(3deg)' }}>
      library-as-landing<br/>good for return visits
    </Note>
  </div>
);

const LandingPrompt = () => (
  <div className="wf full col p-6 gap-4 justify-center items-center text-center">
    <Stamp>NEW · AI WEAVER</Stamp>
    <div className="wf-classic" style={{ fontSize: 26, fontStyle: 'italic', lineHeight: 1.1 }}>
      what tale<br/>shall we weave tonight?
    </div>
    <div className="wf-box p-3" style={{ width: '100%', background: 'var(--paper)', minHeight: 120 }}>
      <div className="wf-typed" style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'left' }}>
        i'm a tired courier in a city of bells, looking for my missing sister...
      </div>
      <div className="row justify-between items-center" style={{ marginTop: 28 }}>
        <div className="row gap-1">
          <Chip>gothic</Chip><Chip>mystery</Chip>
        </div>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>112 / 500</span>
      </div>
    </div>
    <Btn variant="primary" style={{ width: '100%' }}>weave my tale ✦</Btn>
    <div className="row gap-2" style={{ fontSize: 11 }}>
      <span style={{ color: 'var(--ink-faint)' }}>or pick a starter →</span>
      <Scribble><span style={{ color: 'var(--candle)' }}>browse library</span></Scribble>
    </div>
    <Note style={{ bottom: 80, left: -20, transform: 'rotate(-4deg)', width: 100 }}>
      lean into the AI<br/>angle hard
    </Note>
  </div>
);

// ─── Auth & onboarding ──────────────────────────────────────────

const AuthGate = () => (
  <div className="wf full col p-6 gap-4 justify-center">
    <div className="text-center col gap-1">
      <div className="wf-classic" style={{ fontSize: 26, fontStyle: 'italic' }}>before we begin</div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>your tale will be lost if you do not sign your name in the book.</div>
    </div>
    <div className="col gap-2">
      <Btn style={{ width: '100%' }}>continue with google</Btn>
      <Btn style={{ width: '100%' }}>continue with apple</Btn>
      <Btn style={{ width: '100%' }}>email + passphrase</Btn>
    </div>
    <Divider />
    <Btn variant="ghost" style={{ width: '100%', borderStyle: 'dashed' }}>play as guest →</Btn>
    <div style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'center' }}>
      guest progress saves to this browser only
    </div>
    <Note style={{ top: 120, right: 0, width: 100, transform: 'rotate(3deg)' }}>
      reaffirm guests<br/>can keep playing
    </Note>
  </div>
);

const OnboardCharacter = () => (
  <div className="wf full col p-5 gap-3">
    <div className="row justify-between items-center" style={{ fontSize: 11 }}>
      <span style={{ color: 'var(--ink-faint)' }}>step 2 of 3</span>
      <span className="wf-typed">━━━━○━━</span>
    </div>
    <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic', lineHeight: 1 }}>
      who shall you be?
    </div>
    <div className="row gap-3 items-center">
      <Portrait size={60} label="?" />
      <div className="col flex-1 gap-1">
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>name</div>
        <div className="wf-box p-2 wf-typed" style={{ fontSize: 14 }}>Wren of the Hollow</div>
      </div>
    </div>
    <div className="col gap-2">
      <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>distribute 7 motes</div>
      {['Vitality', 'Cunning', 'Charm', 'Lore'].map(s => (
        <div key={s} className="row items-center gap-2">
          <span style={{ width: 60, fontSize: 13 }}>{s}</span>
          <Bar pct={[60, 40, 30, 70][['Vitality','Cunning','Charm','Lore'].indexOf(s)]} candle={s==='Vitality'} />
          <span style={{ width: 30, textAlign: 'right' }} className="wf-typed">─ ＋</span>
        </div>
      ))}
    </div>
    <div className="row gap-2" style={{ marginTop: 'auto' }}>
      <Btn style={{ flex: 1 }}>← back</Btn>
      <Btn variant="primary" style={{ flex: 1 }}>onward →</Btn>
    </div>
  </div>
);

const OnboardMode = () => (
  <div className="wf full col p-5 gap-3">
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>step 3 of 3</div>
    <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic' }}>how shall it end?</div>
    <div className="col gap-3 flex-1">
      <div className="wf-box p-3 col gap-1" style={{ background: 'var(--paper)' }}>
        <div className="row items-center gap-2">
          <Icon name="book" /> <strong style={{ fontSize: 16 }}>Story</strong>
          <span className="wf-typed" style={{ fontSize: 9, color: 'var(--ink-faint)', marginLeft: 'auto' }}>RECOMMENDED</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          undo · bookmark · forgive yourself.<br/>
          you may toggle into hardcore later.
        </div>
      </div>
      <div className="wf-box wf-box-thick p-3 col gap-1" style={{ background: 'var(--paper)' }}>
        <div className="row items-center gap-2">
          <Icon name="skull" /> <strong style={{ fontSize: 16 }}>Hardcore</strong>
          <Stamp style={{ marginLeft: 'auto' }}>permadeath</Stamp>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          no mercy. one save. each choice is final. dying purges the tale.
        </div>
      </div>
    </div>
    <Btn variant="primary">begin the tale →</Btn>
  </div>
);

// ─── Library / home (multi-story view) ──────────────────────────

const LibraryGrid = () => (
  <div className="wf full col p-4 gap-3">
    <div className="row justify-between items-center">
      <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic' }}>your shelf</div>
      <div className="row gap-1">
        <Btn>＋ new tale</Btn>
        <Portrait size={32} label="W" />
      </div>
    </div>
    <div className="wf-tabs">
      <div className="wf-tab" data-active="true">in progress (3)</div>
      <div className="wf-tab">finished (7)</div>
      <div className="wf-tab">starters</div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {[
        { title: 'Heir of Ash', ch: 'ch. 7', pct: 64, hot: true },
        { title: 'Bell-Courier', ch: 'ch. 3', pct: 22 },
        { title: 'Inn at World\'s End', ch: 'ch. 12', pct: 88 },
        { title: '＋ weave new', ch: '', pct: 0, ghost: true },
      ].map((s, i) => (
        <div key={i} className={`wf-box p-2 col gap-1 ${s.ghost ? 'wf-box-dashed' : ''}`} style={{ background: 'var(--paper)', minHeight: 130 }}>
          {!s.ghost ? (
            <>
              <Img label="cover" w="100%" h={70} />
              <div className="wf-classic" style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1 }}>{s.title}</div>
              <div className="row justify-between items-center" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
                <span className="wf-typed">{s.ch}</span>
                <span>{s.pct}%</span>
              </div>
              {s.hot && <Stamp style={{ alignSelf: 'flex-start', fontSize: 8 }}>last played</Stamp>}
            </>
          ) : (
            <div className="full center col gap-1" style={{ color: 'var(--ink-faint)' }}>
              <div style={{ fontSize: 28 }}>✦</div>
              <div style={{ fontSize: 12 }}>weave new tale</div>
            </div>
          )}
        </div>
      ))}
    </div>
    <Note style={{ top: 8, right: -30, transform: 'rotate(3deg)' }}>
      AI tales mixed<br/>w/ curated starters
    </Note>
  </div>
);

const LibraryShelf = () => (
  <div className="wf full col p-4 gap-3">
    <div className="row justify-between items-center">
      <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic' }}>the shelf</div>
      <div className="wf-typed" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>3 / 5 daily turns left</div>
    </div>
    <Divider />
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>continue reading</div>
    <div className="row gap-2" style={{ height: 110 }}>
      {[1,2,3].map(i => (
        <div key={i} className="wf-box p-2 col gap-1 flex-1" style={{ background: 'var(--paper)' }}>
          <div className="wf-classic" style={{ fontSize: 14, fontStyle: 'italic' }}>tale #{i}</div>
          <Lines count={2} />
          <Bar pct={[60,30,80][i-1]} candle />
        </div>
      ))}
    </div>
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>starter adventures</div>
    <div className="col gap-2">
      {['Escape the Training Room', 'The Heir of Ash', 'Bell-Courier'].map((t, i) => (
        <div key={i} className="row items-center gap-3 wf-box p-2" style={{ background: 'var(--paper)' }}>
          <Icon name={['key','skull','book'][i]} size={20} />
          <span style={{ flex: 1, fontSize: 14 }}>{t}</span>
          <span className="wf-typed" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{['10m','45m','30m'][i]}</span>
        </div>
      ))}
    </div>
    <Note style={{ top: 38, right: -10, width: 90, transform: 'rotate(-3deg)' }}>
      turn counter<br/>persistent here
    </Note>
  </div>
);

Object.assign(window, {
  LandingClassic, LandingFullbleed, LandingPicker, LandingPrompt,
  AuthGate, OnboardCharacter, OnboardMode,
  LibraryGrid, LibraryShelf,
});
