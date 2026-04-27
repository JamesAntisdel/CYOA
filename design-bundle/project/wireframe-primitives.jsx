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
