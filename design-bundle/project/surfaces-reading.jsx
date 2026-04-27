// Main reading view — the heart of the product. 5 layout directions.
// Always-visible stats with mode variations.

// ─── A · Classic Book ───────────────────────────────────────────
const ReadBook = () => (
  <div className="wf full col p-4 gap-2">
    <div className="row justify-between items-center" style={{ fontSize: 11 }}>
      <span className="wf-typed">CHAPTER III · THE BELL TOWER</span>
      <div className="row gap-1">
        <Chip><Icon name="heart" size={11} /> 38/50</Chip>
        <Chip><Icon name="coin" size={11} /> 12</Chip>
        <Chip><Icon name="sack" size={11} /> 4</Chip>
      </div>
    </div>
    <div className="flex-1 col gap-2 wf-classic" style={{ padding: '14px 18px', background: 'var(--paper)', border: '1.5px solid var(--ink-ghost)' }}>
      <div style={{ fontSize: 13, fontStyle: 'italic', lineHeight: 1.5 }}>
        The bell-rope is wet. Someone has been here before you, and recently — though the dust on the stair tells a different tale...
      </div>
      <Lines count={5} last="50%" />
      <div style={{ fontSize: 13, fontStyle: 'italic', lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        A whisper from above: <em>"don't ring it. not yet."</em>
      </div>
    </div>
    <div className="col gap-1">
      <Choice>climb toward the voice</Choice>
      <Choice>pull the rope anyway</Choice>
      <Choice locked hint="Lore &lt; 4">read the carving on the bell <Icon name="key" size={11} /></Choice>
    </div>
    <div className="row justify-between" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
      <span>↺ undo</span>
      <span>≡ menu</span>
      <span>★ bookmark</span>
    </div>
    <Note style={{ top: 60, right: -6, width: 80, transform: 'rotate(3deg)' }}>book column<br/>centered, paged</Note>
  </div>
);

// ─── B · Journal / typed ────────────────────────────────────────
const ReadJournal = () => (
  <div className="wf full col p-4 gap-2 wf-typed" style={{ fontSize: 12 }}>
    <div className="row justify-between" style={{ fontSize: 10 }}>
      <span>&gt; chapter_03.md</span>
      <span>HP·38 ▮▮▮▮▯ G·12</span>
    </div>
    <div className="flex-1 col gap-2" style={{ padding: 10, border: '1.5px dashed var(--ink-ghost)', background: 'var(--paper)' }}>
      <div>The bell-rope is wet.</div>
      <div>Someone has been here before you, and recently —</div>
      <div>though the dust on the stair tells a different tale.</div>
      <div style={{ marginTop: 8, color: 'var(--candle)' }}>+1 INTUITION</div>
      <div style={{ marginTop: 8 }}>A whisper from above:</div>
      <div style={{ paddingLeft: 14, color: 'var(--ink-soft)' }}>"don't ring it. not yet."</div>
      <div style={{ marginTop: 8, color: 'var(--ink-faint)' }}>▍</div>
    </div>
    <div className="col gap-1">
      <div className="wf-box p-2" style={{ borderStyle: 'solid' }}>1 ▸ climb toward the voice</div>
      <div className="wf-box p-2" style={{ borderStyle: 'solid' }}>2 ▸ pull the rope anyway</div>
      <div className="wf-box p-2" style={{ opacity: 0.5, borderStyle: 'dashed' }}>3 ▸ [LORE 4] read the carving</div>
    </div>
    <Note style={{ top: 50, left: -28, width: 90, transform: 'rotate(-3deg)' }}>terminal/journal<br/>vibe — typed text</Note>
  </div>
);

// ─── C · Graphic novel ──────────────────────────────────────────
const ReadGraphic = () => (
  <div className="wf full col gap-0" style={{ padding: 0 }}>
    <div className="row p-2 justify-between items-center" style={{ fontSize: 11, borderBottom: '1.5px solid var(--ink)' }}>
      <span className="wf-typed">CH 3 · THE BELL TOWER</span>
      <div className="row gap-1">
        <Bar pct={76} candle style={{ width: 60 }} />
        <span className="wf-typed" style={{ fontSize: 10 }}>38</span>
      </div>
    </div>
    <div className="flex-1 relative">
      <Img label="full-panel · belltower interior, candle" w="100%" h="100%" style={{ borderRadius: 0, border: 'none' }} />
      <div className="absolute" style={{ left: 14, top: 16, maxWidth: 140 }}>
        <div className="wf-box p-2" style={{ background: 'var(--paper)' }}>
          <div className="wf-classic" style={{ fontSize: 13, fontStyle: 'italic', lineHeight: 1.2 }}>
            the rope is wet.<br/>someone was here.
          </div>
        </div>
      </div>
      <div className="absolute" style={{ right: 14, bottom: 110, maxWidth: 140 }}>
        <div className="wf-box p-2" style={{ background: 'var(--paper)', transform: 'rotate(2deg)' }}>
          <div className="wf-classic" style={{ fontSize: 12, fontStyle: 'italic' }}>
            "don't ring it.<br/>not yet."
          </div>
        </div>
      </div>
    </div>
    <div className="col gap-1 p-2" style={{ background: 'var(--paper)', borderTop: '1.5px solid var(--ink)' }}>
      <Choice>climb toward the voice</Choice>
      <Choice>pull the rope anyway</Choice>
    </div>
    <Note style={{ top: 80, right: -10, width: 90, transform: 'rotate(4deg)' }}>image-led<br/>pro tier</Note>
  </div>
);

// ─── D · Modern app ─────────────────────────────────────────────
const ReadApp = () => (
  <div className="wf full col" style={{ padding: 0 }}>
    {/* sticky stat bar top */}
    <div className="row p-2 gap-2 items-center" style={{ borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
      <Portrait size={28} label="W" />
      <div className="col flex-1 gap-1">
        <div className="row justify-between" style={{ fontSize: 10 }}>
          <span>Wren</span>
          <span className="wf-typed">Ch3 · §14</span>
        </div>
        <Bar pct={76} candle />
      </div>
      <Chip><Icon name="coin" size={10} />12</Chip>
      <Chip><Icon name="sack" size={10} />4</Chip>
    </div>
    <div className="flex-1 col gap-2 p-3" style={{ overflow: 'hidden' }}>
      <div className="wf-classic" style={{ fontSize: 13, fontStyle: 'italic', lineHeight: 1.5 }}>
        The bell-rope is wet. Someone has been here before you...
      </div>
      <Lines count={3} last="55%" />
    </div>
    <div className="col gap-1 p-2" style={{ background: 'var(--paper-2)', borderTop: '1.5px solid var(--ink)' }}>
      <div className="wf-box p-2 row items-center" style={{ background: 'var(--paper)' }}>
        <span style={{ flex: 1 }}>climb toward the voice</span>
        <span className="wf-typed" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>+lore</span>
      </div>
      <div className="wf-box p-2 row items-center" style={{ background: 'var(--paper)' }}>
        <span style={{ flex: 1 }}>pull the rope anyway</span>
        <span className="wf-typed" style={{ fontSize: 9, color: 'var(--candle)' }}>?? risky</span>
      </div>
    </div>
    <Note style={{ top: 0, left: -34, width: 110, transform: 'rotate(-4deg)' }}>persistent stat<br/>HUD top + bottom</Note>
  </div>
);

// ─── E · Side-margin (book + marginalia) ────────────────────────
const ReadMargin = () => (
  <div className="wf full row p-3 gap-2">
    <div className="col flex-1 gap-2">
      <div className="wf-typed" style={{ fontSize: 10 }}>CH 3 · THE BELL TOWER</div>
      <div className="flex-1 wf-classic" style={{ padding: '12px 14px', fontSize: 13, fontStyle: 'italic', lineHeight: 1.55, background: 'var(--paper)' }}>
        The bell-rope is wet. Someone has been here before you, and recently — though the dust on the stair tells a different tale.
        <Lines count={3} />
        <em>"don't ring it. not yet."</em>
      </div>
      <div className="col gap-1">
        <Choice>climb toward the voice</Choice>
        <Choice>pull the rope anyway</Choice>
      </div>
    </div>
    <div className="col gap-2" style={{ width: 80, fontSize: 10 }}>
      <div className="text-center" style={{ color: 'var(--ink-faint)' }}>WREN</div>
      <Bar pct={76} candle />
      <div className="text-center wf-typed">38/50</div>
      <Divider />
      <div className="col gap-1 items-center">
        <Chip>12g</Chip>
        <Chip>key</Chip>
        <Chip>note</Chip>
        <Chip>—</Chip>
      </div>
      <Divider />
      <div className="text-center" style={{ color: 'var(--candle)', fontStyle: 'italic' }}>+1 lore</div>
    </div>
    <Note style={{ top: 4, right: -18, width: 80, transform: 'rotate(4deg)' }}>marginalia<br/>like a study<br/>notebook</Note>
  </div>
);

// ─── Stats display modes ────────────────────────────────────────
const StatsHud = () => (
  <div className="wf full col p-3 gap-2">
    <div className="wf-typed" style={{ fontSize: 10 }}>MODE A · TOP HUD (always)</div>
    <div className="row p-2 gap-2 items-center" style={{ background: 'var(--paper-2)', border: '1.5px solid var(--ink)', borderRadius: 4 }}>
      <Portrait size={26} label="W" />
      <Bar pct={76} candle />
      <span className="wf-typed" style={{ fontSize: 10 }}>38/50</span>
      <Chip>12g</Chip>
      <Chip>4 ✦</Chip>
    </div>
    <div className="wf-typed" style={{ fontSize: 10, marginTop: 6 }}>MODE B · MARGINALIA (sidebar)</div>
    <div className="row gap-2">
      <div className="flex-1 wf-box p-2" style={{ background: 'var(--paper)' }}>
        <Lines count={3} last="40%" />
      </div>
      <div className="col gap-1 wf-box p-2" style={{ width: 60, background: 'var(--paper-2)' }}>
        <div className="text-center wf-typed" style={{ fontSize: 9 }}>WREN</div>
        <Bar pct={76} candle />
        <Chip>12g</Chip><Chip>key</Chip>
      </div>
    </div>
    <div className="wf-typed" style={{ fontSize: 10, marginTop: 6 }}>MODE C · CONTEXTUAL (peek-on-change)</div>
    <div className="relative" style={{ background: 'var(--paper)', border: '1.5px solid var(--ink)', borderRadius: 4, padding: 8, minHeight: 60 }}>
      <Lines count={2} />
      <div className="wf-box absolute" style={{ top: -10, right: 10, padding: '2px 8px', background: 'var(--candle)', color: 'var(--paper)', fontSize: 11, transform: 'rotate(-2deg)' }}>
        +1 LORE · −5 HP
      </div>
    </div>
    <div className="wf-typed" style={{ fontSize: 10, marginTop: 6 }}>MODE D · DRAWER (icon → expands)</div>
    <div className="row items-center gap-2 wf-box p-2" style={{ background: 'var(--paper-2)' }}>
      <Icon name="eye" size={14} />
      <span style={{ flex: 1, fontSize: 12 }}>tap to peek your stats</span>
      <span className="wf-typed" style={{ fontSize: 10, color: 'var(--candle)' }}>● change</span>
    </div>
    <Note style={{ bottom: 10, right: -10, width: 100, transform: 'rotate(2deg)' }}>let user pick<br/>their density</Note>
  </div>
);

const StatsInventory = () => (
  <div className="wf full col p-3 gap-2">
    <div className="row justify-between items-center">
      <div className="wf-classic" style={{ fontSize: 20, fontStyle: 'italic' }}>your purse &amp; pack</div>
      <span style={{ fontSize: 12 }}>×</span>
    </div>
    <div className="row gap-2 items-center">
      <Portrait size={50} label="W" />
      <div className="col flex-1 gap-1">
        <div className="wf-classic" style={{ fontSize: 16, fontStyle: 'italic' }}>Wren of the Hollow</div>
        <Bar pct={76} candle />
        <div className="wf-typed" style={{ fontSize: 10 }}>VIT 38/50 · GOLD 12</div>
      </div>
    </div>
    <Divider />
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>worn</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {['cloak','blade','—','—'].map((t,i) => (
        <div key={i} className="wf-box p-2 text-center" style={{ aspectRatio: '1/1', fontSize: 11, background: 'var(--paper)' }}>{t}</div>
      ))}
    </div>
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>satchel</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {['rusty key','bell-shard','letter','herb','—','—','—','—'].map((t,i) => (
        <div key={i} className="wf-box p-2 text-center" style={{ aspectRatio: '1/1', fontSize: 10, background: t==='—' ? 'var(--paper-2)' : 'var(--paper)', opacity: t==='—'?0.5:1 }}>{t}</div>
      ))}
    </div>
    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>tags whispered</div>
    <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
      {['met queen','spared rat','knows true name'].map(t => <Chip key={t}>{t}</Chip>)}
    </div>
  </div>
);

Object.assign(window, {
  ReadBook, ReadJournal, ReadGraphic, ReadApp, ReadMargin,
  StatsHud, StatsInventory,
});
