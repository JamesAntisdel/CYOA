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
