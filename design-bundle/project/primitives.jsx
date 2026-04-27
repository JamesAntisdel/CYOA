// Reusable sketch primitives for wireframes
// All components are tiny presentational helpers — no state.

const Stamp = ({ children, style }) => (
  <div className="wf-stamp" style={style}>{children}</div>
);

const Note = ({ children, style }) => (
  <div className="wf-note" style={style}>{children}</div>
);

// Curved arrow SVG, used to point notes at things
const NoteArrow = ({ d, style }) => (
  <svg className="wf-note-arrow" style={style} viewBox="0 0 100 100" preserveAspectRatio="none">
    <path d={d} fill="none" stroke="#c8541e" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const Line = ({ w = '100%', h = 9, style }) => (
  <div className="wf-line" style={{ width: w, height: h, ...style }} />
);

const Lines = ({ count = 4, last = '60%' }) => (
  <div>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="wf-line"
        style={{ width: i === count - 1 ? last : `${88 + (i % 3) * 4}%` }}
      />
    ))}
  </div>
);

const Img = ({ label = 'image', w = '100%', h = 100, style }) => (
  <div className="wf-img" style={{ width: w, height: h, ...style }}>
    <span>{label}</span>
  </div>
);

const Portrait = ({ size = 36, label = 'portrait', style }) => (
  <div className="wf-portrait" style={{ width: size, height: size, ...style }}>
    {label}
  </div>
);

const Btn = ({ children, variant = 'default', style, ...rest }) => {
  const cls = variant === 'primary'
    ? 'wf-btn wf-btn-primary'
    : variant === 'ghost'
      ? 'wf-btn wf-btn-ghost'
      : variant === 'locked'
        ? 'wf-btn wf-btn-locked'
        : 'wf-btn';
  return <button className={cls} style={style} {...rest}>{children}</button>;
};

const Choice = ({ children, locked, hint, style }) => (
  <div
    className="wf-choice"
    style={{ ...(locked ? { opacity: 0.5, borderStyle: 'dashed' } : {}), ...style }}
  >
    <span style={{ flex: 1 }}>{children}</span>
    {hint && <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'Special Elite, monospace' }}>{hint}</span>}
  </div>
);

const Chip = ({ icon, children, style }) => (
  <div className="wf-chip" style={style}>
    {icon && <span>{icon}</span>}
    {children}
  </div>
);

const Bar = ({ pct = 60, candle, style }) => (
  <div className="wf-bar" style={style}>
    <div className={`wf-bar-fill${candle ? ' candle' : ''}`} style={{ width: `${pct}%` }} />
  </div>
);

const Flourish = ({ style }) => (
  <div className="wf-flourish" style={{ textAlign: 'center', ...style }}>❦ ❧ ❦</div>
);

const Scribble = ({ children, style }) => (
  <span className="wf-scribble" style={style}>{children}</span>
);

// Rough hand-drawn divider line
const Divider = ({ style }) => (
  <svg viewBox="0 0 200 6" preserveAspectRatio="none" style={{ width: '100%', height: 6, ...style }}>
    <path d="M2 3 Q 30 1 60 3 T 120 3 T 198 3" fill="none" stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

// Tiny corner-stamp: candle / book / hourglass icons drawn rough.
const Icon = ({ name = 'candle', size = 16, color = 'currentColor' }) => {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle' };
  switch (name) {
    case 'candle':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2 Q 9 4 8 5 Q 7 4 8 2 Z" fill="#c8541e" stroke="#c8541e" />
          <path d="M8 5 V 7" />
          <rect x="5.5" y="7" width="5" height="6" rx="0.5" />
          <path d="M5 13 H 11" />
        </svg>
      );
    case 'book':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round">
          <path d="M2 3 Q 5 2 8 3 Q 11 2 14 3 V 13 Q 11 12 8 13 Q 5 12 2 13 Z" />
          <path d="M8 3 V 13" />
        </svg>
      );
    case 'heart':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round">
          <path d="M8 13 Q 2 9 2 6 Q 2 3 5 3 Q 7 3 8 5 Q 9 3 11 3 Q 14 3 14 6 Q 14 9 8 13 Z" />
        </svg>
      );
    case 'coin':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.4">
          <circle cx="8" cy="8" r="5.5" />
          <text x="8" y="11" textAnchor="middle" fontSize="7" fontFamily="Special Elite" fill={color} stroke="none">G</text>
        </svg>
      );
    case 'sack':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2">
          <path d="M5 3 H 11 L 13 6 Q 14 13 8 13 Q 2 13 3 6 Z" />
          <path d="M5 3 L 6 5 H 10 L 11 3" />
        </svg>
      );
    case 'skull':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round">
          <path d="M3 7 Q 3 2 8 2 Q 13 2 13 7 V 10 H 11 V 13 H 5 V 10 H 3 Z" />
          <circle cx="6" cy="8" r="1" fill={color} />
          <circle cx="10" cy="8" r="1" fill={color} />
          <path d="M7 11 H 9" />
        </svg>
      );
    case 'eye':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2">
          <path d="M2 8 Q 8 3 14 8 Q 8 13 2 8 Z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case 'hourglass':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round">
          <path d="M4 2 H 12 L 8 8 L 12 14 H 4 L 8 8 Z" />
        </svg>
      );
    case 'key':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2">
          <circle cx="5" cy="8" r="2.5" />
          <path d="M7.5 8 H 14 M 11 8 V 11 M 13 8 V 10" />
        </svg>
      );
    case 'people':
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke={color} strokeWidth="1.2">
          <circle cx="6" cy="6" r="2" />
          <path d="M2 13 Q 2 9 6 9 Q 10 9 10 13" />
          <circle cx="12" cy="6" r="1.5" />
          <path d="M10 13 Q 10 10 12 10 Q 14 10 14 13" />
        </svg>
      );
    default: return null;
  }
};

// Sketchy crooked rectangle (for backdrops, panels)
const Crooked = ({ children, style, rotate = -0.4, fill }) => (
  <div
    className="wf-box"
    style={{
      transform: `rotate(${rotate}deg)`,
      background: fill || 'var(--paper)',
      ...style,
    }}
  >
    {children}
  </div>
);

Object.assign(window, {
  Stamp, Note, NoteArrow, Line, Lines, Img, Portrait, Btn, Choice, Chip,
  Bar, Flourish, Scribble, Divider, Icon, Crooked,
});
