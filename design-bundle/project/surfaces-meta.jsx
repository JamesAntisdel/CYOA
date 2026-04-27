// Co-op / pass-the-controller, ending map, death, paywall
// 3-5 directions per surface

// ─── Co-op / pass-the-controller ────────────────────────────────

const CoopLobby = () => (
  <div className="wf full col p-4 gap-3">
    <div className="text-center col gap-1">
      <div className="wf-classic" style={{ fontSize: 22, fontStyle: 'italic' }}>around the candle</div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>3 readers gathered</div>
    </div>
    <div className="col gap-2">
      {[
        { name: 'Wren', role: 'storyteller', here: true },
        { name: 'Mira', role: 'voice 2', here: true },
        { name: 'Bram', role: 'voice 3', here: true },
        { name: '— empty —', role: 'awaiting', here: false },
      ].map((p, i) => (
        <div key={i} className="row items-center gap-2 wf-box p-2" style={{ opacity: p.here ? 1 : 0.5, borderStyle: p.here ? 'solid' : 'dashed', background: 'var(--paper)' }}>
          <Portrait size={32} label={p.here ? p.name[0] : '?'} />
          <div className="col flex-1">
            <span style={{ fontSize: 14 }}>{p.name}</span>
            <span className="wf-typed" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{p.role}</span>
          </div>
          {p.here && i === 0 && <Stamp style={{ fontSize: 8 }}>host</Stamp>}
        </div>
      ))}
    </div>
    <Divider />
    <div className="wf-box p-2 row items-center gap-2" style={{ background: 'var(--paper-2)' }}>
      <span className="wf-typed" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>share link</span>
      <span className="wf-typed flex-1" style={{ fontSize: 11 }}>tome.gg/c/wreNwa</span>
      <Btn>copy</Btn>
    </div>
    <Btn variant="primary">begin the reading →</Btn>
    <Note style={{ top: 70, right: -10, width: 90, transform: 'rotate(3deg)' }}>same screen<br/>OR remote</Note>
  </div>
);

const CoopTurn = () => (
  <div className="wf full col p-3 gap-2">
    {/* whose turn banner */}
    <div className="wf-box wf-box-thick p-2 row items-center gap-2" style={{ background: 'var(--candle-soft)', borderColor: 'var(--candle)' }}>
      <Portrait size={28} label="M" />
      <span style={{ fontSize: 13, flex: 1 }}><strong>Mira</strong>'s choice</span>
      <span className="wf-typed" style={{ fontSize: 10, color: 'var(--candle)' }}>0:12</span>
    </div>
    <div className="flex-1 wf-classic" style={{ padding: 10, background: 'var(--paper)', border: '1.5px solid var(--ink-ghost)', fontSize: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
      The bell-rope is wet. <Lines count={2} last="40%" />
    </div>
    <div className="col gap-1">
      <Choice>climb toward the voice</Choice>
      <Choice>pull the rope anyway</Choice>
    </div>
    <div className="row gap-1 items-center" style={{ fontSize: 10 }}>
      <Portrait size={18} label="W" />
      <Portrait size={18} label="M" style={{ borderColor: 'var(--candle)', borderWidth: 2 }} />
      <Portrait size={18} label="B" />
      <span style={{ flex: 1, color: 'var(--ink-faint)', marginLeft: 6 }}>round-robin</span>
      <span className="wf-typed">pass →</span>
    </div>
    <Note style={{ top: 70, left: -10, width: 90, transform: 'rotate(-3deg)' }}>active reader<br/>highlighted</Note>
  </div>
);

const CoopVote = () => (
  <div className="wf full col p-3 gap-2">
    <div className="wf-typed" style={{ fontSize: 10, textAlign: 'center', color: 'var(--ink-faint)' }}>
      VOTING · 0:08 left
    </div>
    <div className="wf-classic" style={{ fontSize: 12, fontStyle: 'italic', padding: 8, background: 'var(--paper)', border: '1.5px solid var(--ink-ghost)' }}>
      The bell-rope is wet... <em>"don't ring it. not yet."</em>
    </div>
    <div className="col gap-2">
      <div className="wf-box p-2 col gap-1" style={{ background: 'var(--paper)' }}>
        <span style={{ fontSize: 13 }}>climb toward the voice</span>
        <div className="row items-center gap-1">
          <Portrait size={16} label="W" />
          <Portrait size={16} label="B" />
          <Bar pct={66} style={{ flex: 1 }} />
          <span className="wf-typed" style={{ fontSize: 10 }}>2/3</span>
        </div>
      </div>
      <div className="wf-box p-2 col gap-1" style={{ background: 'var(--paper)' }}>
        <span style={{ fontSize: 13 }}>pull the rope anyway</span>
        <div className="row items-center gap-1">
          <Portrait size={16} label="M" />
          <Bar pct={33} style={{ flex: 1 }} />
          <span className="wf-typed" style={{ fontSize: 10 }}>1/3</span>
        </div>
      </div>
    </div>
    <Btn variant="ghost" style={{ marginTop: 'auto' }}>change my vote</Btn>
    <Note style={{ top: 12, right: -16, width: 90, transform: 'rotate(3deg)' }}>everyone votes<br/>per choice</Note>
  </div>
);

// ─── Ending map / branching web ─────────────────────────────────

const EndingMap = () => (
  <div className="wf full col p-3 gap-2">
    <div className="row justify-between items-center">
      <div className="wf-classic" style={{ fontSize: 20, fontStyle: 'italic' }}>your tangled tale</div>
      <span className="wf-typed" style={{ fontSize: 10 }}>3 / 12 endings</span>
    </div>
    <div className="flex-1 relative wf-box" style={{ background: 'var(--paper)', overflow: 'hidden' }}>
      <svg viewBox="0 0 280 320" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {/* paths */}
        <g fill="none" stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M140 20 Q 140 40 100 60" />
          <path d="M140 20 Q 140 40 180 60" />
          <path d="M100 60 Q 80 90 60 120" />
          <path d="M100 60 Q 100 90 130 120" />
          <path d="M180 60 Q 200 90 220 120" />
          <path d="M180 60 Q 170 90 160 120" />
          <path d="M60 120 Q 40 160 50 200" strokeDasharray="3 3" stroke="var(--ink-faint)" />
          <path d="M130 120 Q 130 160 110 200" stroke="var(--candle)" strokeWidth="2" />
          <path d="M160 120 Q 170 160 180 200" strokeDasharray="3 3" stroke="var(--ink-faint)" />
          <path d="M220 120 Q 240 160 230 200" />
          <path d="M50 200 Q 60 240 80 280" strokeDasharray="3 3" stroke="var(--ink-faint)" />
          <path d="M110 200 Q 110 240 110 280" stroke="var(--candle)" strokeWidth="2" />
          <path d="M180 200 Q 180 240 180 280" />
          <path d="M230 200 Q 230 240 220 280" strokeDasharray="3 3" stroke="var(--ink-faint)" />
        </g>
        {/* nodes */}
        {[
          [140, 20, '◉', 'visited'],
          [100, 60, '◉', 'visited'],
          [180, 60, '◉', 'visited'],
          [60, 120, '○', 'visited'],
          [130, 120, '◉', 'current'],
          [160, 120, '○', 'visited'],
          [220, 120, '○', 'visited'],
          [50, 200, '?', 'unvisited'],
          [110, 200, '◉', 'current'],
          [180, 200, '○', 'visited'],
          [230, 200, '?', 'unvisited'],
          [80, 280, '?', 'unvisited'],
          [110, 280, '★', 'ending'],
          [180, 280, '☠', 'ending'],
          [220, 280, '?', 'unvisited'],
        ].map(([x, y, glyph, kind], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="9"
              fill={kind === 'unvisited' ? 'var(--paper-2)' : 'var(--paper)'}
              stroke={kind === 'current' ? 'var(--candle)' : 'var(--ink)'}
              strokeWidth={kind === 'current' ? '2' : '1.2'} />
            <text x={x} y={y+3} textAnchor="middle" fontSize="9"
              fill={kind === 'unvisited' ? 'var(--ink-faint)' : 'var(--ink)'}
              fontFamily="Special Elite">{glyph}</text>
          </g>
        ))}
      </svg>
    </div>
    <div className="row gap-2" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
      <span>◉ taken</span>
      <span style={{ color: 'var(--candle)' }}>● now</span>
      <span>★ ending</span>
      <span>☠ death</span>
      <span>? unseen</span>
    </div>
    <Note style={{ top: 90, left: -10, width: 90, transform: 'rotate(-3deg)' }}>fog-of-war<br/>style map</Note>
  </div>
);

const EndingTrophyRoom = () => (
  <div className="wf full col p-3 gap-2">
    <div className="wf-classic text-center" style={{ fontSize: 22, fontStyle: 'italic' }}>the endings hall</div>
    <div className="text-center wf-typed" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>4 of 12 unlocked</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {[
        { glyph: '★', name: 'The Ascent', sub: 'rang the bell' },
        { glyph: '☠', name: 'Drowned', sub: 'fell from tower' },
        { glyph: '✦', name: 'Whispermaker', sub: 'spared the voice' },
        { glyph: '?', name: '???', sub: 'undiscovered', locked: true },
        { glyph: '?', name: '???', sub: 'undiscovered', locked: true },
        { glyph: '?', name: '???', sub: 'undiscovered', locked: true },
      ].map((e, i) => (
        <div key={i} className={`wf-box p-2 col gap-1 text-center ${e.locked ? 'wf-box-dashed' : ''}`} style={{ background: 'var(--paper)', opacity: e.locked ? 0.6 : 1 }}>
          <div style={{ fontSize: 26, fontFamily: 'IM Fell English' }}>{e.glyph}</div>
          <div className="wf-classic" style={{ fontSize: 14, fontStyle: 'italic' }}>{e.name}</div>
          <div className="wf-typed" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>{e.sub}</div>
        </div>
      ))}
    </div>
    <Note style={{ top: 100, right: -10, width: 90, transform: 'rotate(2deg)' }}>card-style<br/>collectables</Note>
  </div>
);

// ─── Death screen — brutal full-screen ──────────────────────────

const DeathBrutal = () => (
  <div className="wf full center col" style={{ background: '#1a1410', color: '#f4ecd8' }}>
    <div className="text-center col gap-3 p-4">
      <div style={{ fontSize: 80, lineHeight: 1, fontFamily: 'IM Fell English', fontStyle: 'italic' }}>☠</div>
      <div className="wf-classic" style={{ fontSize: 36, fontStyle: 'italic', lineHeight: 1 }}>here ends<br/>your tale.</div>
      <Divider style={{ filter: 'invert(1)' }} />
      <div className="wf-typed" style={{ fontSize: 11, color: 'var(--candle)', letterSpacing: '0.15em' }}>
        WREN OF THE HOLLOW · CHAPTER III · §14
      </div>
      <div className="wf-classic" style={{ fontSize: 14, fontStyle: 'italic', color: '#bdb0a0', maxWidth: 220 }}>
        the bell tolled, &amp; the floor gave way beneath you.
      </div>
    </div>
    <Note style={{ top: 12, right: 8, color: 'var(--candle)' }}>full-bleed,<br/>no chrome</Note>
    <div className="absolute" style={{ bottom: 16, left: 16, right: 16 }}>
      <div className="row gap-2 justify-center">
        <Btn style={{ background: 'transparent', borderColor: '#f4ecd8', color: '#f4ecd8' }}>view tale</Btn>
        <Btn variant="primary" style={{ background: '#f4ecd8', color: '#1a1410' }}>begin anew →</Btn>
      </div>
    </div>
  </div>
);

const DeathHardcore = () => (
  <div className="wf full center col p-4" style={{ background: '#1a1410', color: '#f4ecd8' }}>
    <div className="text-center col gap-2">
      <Stamp style={{ borderColor: 'var(--candle)', color: 'var(--candle)' }}>HARDCORE · PURGED</Stamp>
      <div className="wf-classic" style={{ fontSize: 32, fontStyle: 'italic', lineHeight: 1 }}>
        the tale<br/>is unmade.
      </div>
      <div style={{ fontSize: 12, color: '#bdb0a0', maxWidth: 200, margin: '8px auto' }}>
        every page you wrote has been cut from the spine. nothing remains.
      </div>
      <div className="wf-box p-2" style={{ background: 'rgba(244,236,216,0.05)', borderColor: '#bdb0a0', maxWidth: 200, margin: '8px auto' }}>
        <div className="wf-typed" style={{ fontSize: 10, color: '#bdb0a0' }}>WHAT YOU LOST</div>
        <div style={{ fontSize: 12 }}>· 3h 24m of reading</div>
        <div style={{ fontSize: 12 }}>· 47 choices made</div>
        <div style={{ fontSize: 12 }}>· 2 endings undiscovered</div>
      </div>
      <Btn variant="primary" style={{ background: '#f4ecd8', color: '#1a1410', marginTop: 12 }}>
        write another →
      </Btn>
    </div>
    <Note style={{ top: 10, left: 8, color: 'var(--candle)' }}>show what was<br/>lost — sting</Note>
  </div>
);

// ─── Paywall — daily turn limit ─────────────────────────────────

const PaywallSoft = () => (
  <div className="wf full col p-4 gap-3 justify-center">
    <div className="text-center col gap-2">
      <Icon name="hourglass" size={38} color="var(--candle)" />
      <div className="wf-classic" style={{ fontSize: 24, fontStyle: 'italic', lineHeight: 1 }}>
        the candle dims.
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', maxWidth: 240, margin: '0 auto' }}>
        you've used your 30 free turns today. return at midnight, or...
      </div>
    </div>
    <div className="wf-box wf-box-thick p-3 col gap-2" style={{ background: 'var(--paper)' }}>
      <div className="row justify-between items-center">
        <div className="wf-classic" style={{ fontSize: 18, fontStyle: 'italic' }}>the Reader's Pact</div>
        <Stamp>$5/mo</Stamp>
      </div>
      <div className="col gap-1" style={{ fontSize: 12 }}>
        <div>· unlimited turns</div>
        <div>· cloud sync across devices</div>
        <div>· bookmark any branch</div>
      </div>
      <Btn variant="primary">subscribe</Btn>
    </div>
    <div className="wf-box p-3 col gap-2" style={{ background: 'var(--paper-2)' }}>
      <div className="row justify-between items-center">
        <div className="wf-classic" style={{ fontSize: 18, fontStyle: 'italic' }}>the Illuminated Pact</div>
        <Stamp>$12/mo</Stamp>
      </div>
      <div className="col gap-1" style={{ fontSize: 12 }}>
        <div>· everything above</div>
        <div>· ✦ storybook AI illustrations</div>
        <div>· ambient music tracks</div>
        <div>· early-access tales</div>
      </div>
      <Btn>upgrade</Btn>
    </div>
    <Btn variant="ghost">come back tomorrow</Btn>
    <Note style={{ top: 30, right: -10, width: 100, transform: 'rotate(3deg)' }}>two-tier ladder<br/>basic / illuminated</Note>
  </div>
);

const PaywallInline = () => (
  <div className="wf full col p-3 gap-2">
    {/* normal-looking reading view, but with a paywall card mid-text */}
    <div className="wf-typed" style={{ fontSize: 10 }}>CH 3 · §16</div>
    <div className="wf-classic" style={{ padding: 10, background: 'var(--paper)', border: '1.5px solid var(--ink-ghost)', fontSize: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
      You step into the next chamber, and—
    </div>
    {/* paywall slab */}
    <div className="wf-box wf-box-thick p-3 col gap-2 relative" style={{ background: 'var(--paper-2)' }}>
      <div className="absolute" style={{ top: -8, left: 12 }}>
        <Stamp style={{ background: 'var(--paper)' }}>candle dimmed</Stamp>
      </div>
      <div className="wf-classic" style={{ fontSize: 16, fontStyle: 'italic', marginTop: 6 }}>
        the next page is sealed in wax.
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
        free readers turn 30 pages a day. you've turned them all.
      </div>
      <div className="row gap-2 wf-typed" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
        <span>◷ resets in 4h 12m</span>
      </div>
      <div className="row gap-2">
        <Btn variant="primary" style={{ flex: 1 }}>break the seal · $5/mo</Btn>
        <Btn>+turns</Btn>
      </div>
    </div>
    <div className="col gap-1" style={{ opacity: 0.35, pointerEvents: 'none' }}>
      <Choice>open the door</Choice>
      <Choice>retreat</Choice>
    </div>
    <Note style={{ bottom: 80, right: -16, width: 100, transform: 'rotate(2deg)' }}>paywall sits<br/>in the page<br/>itself</Note>
  </div>
);

const PaywallTopBar = () => (
  <div className="wf full col p-3 gap-2">
    <div className="wf-typed" style={{ fontSize: 10, textAlign: 'center', color: 'var(--ink-faint)' }}>
      MINIMAL · TURN COUNTER VARIANT
    </div>
    {/* persistent counter near HUD */}
    <div className="wf-box p-2 row items-center gap-2" style={{ background: 'var(--paper)' }}>
      <Portrait size={24} label="W" />
      <Bar pct={50} candle />
      <Chip><Icon name="hourglass" size={11} color="var(--candle)" /> 4 / 30</Chip>
    </div>
    <div className="wf-classic" style={{ padding: 10, background: 'var(--paper)', border: '1.5px solid var(--ink-ghost)', fontSize: 12, fontStyle: 'italic', flex: 1 }}>
      <Lines count={4} />
    </div>
    {/* tiny upsell strip */}
    <div className="wf-box p-2 row items-center gap-2" style={{ background: 'var(--candle-soft)', borderColor: 'var(--candle)' }}>
      <Icon name="hourglass" size={14} color="var(--candle)" />
      <span style={{ fontSize: 11, flex: 1 }}>your candle wanes — 4 turns left today.</span>
      <Btn style={{ borderColor: 'var(--candle)', color: 'var(--candle)', fontSize: 11, padding: '2px 8px' }}>upgrade</Btn>
    </div>
    <Note style={{ top: 70, left: -16, width: 90, transform: 'rotate(-3deg)' }}>nudge in HUD<br/>not interruptive</Note>
  </div>
);

Object.assign(window, {
  CoopLobby, CoopTurn, CoopVote,
  EndingMap, EndingTrophyRoom,
  DeathBrutal, DeathHardcore,
  PaywallSoft, PaywallInline, PaywallTopBar,
});
