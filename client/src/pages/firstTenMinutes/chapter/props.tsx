/**
 * The courtyard's props, drawn by hand: a teapot in its knitted cosy, the cosy worn as an oven glove, Pip's pumpkin,
 * a shed quill, the inkwell, Hazel's writing table with her complaint and acorn stamp. Small, warm, a little wonky.
 */
const INK = "#3b2a1c";

export function TeaCosy({ worn = false }: { worn?: boolean }) {
  return (
    <svg viewBox="0 0 120 110" role="img" aria-label={worn ? "Tea cosy, gone" : "A teapot in a knitted tea cosy"}>
      {/* the teapot underneath */}
      <ellipse cx="60" cy="96" rx="42" ry="7" fill="rgba(0,0,0,0.18)" />
      <path d="M18 70 C 6 64, 4 52, 14 50" stroke="#e8dcc4" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M102 62 C 114 58, 116 44, 110 38" stroke="#e8dcc4" strokeWidth="7" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="74" rx="40" ry="22" fill="#efe6d4" stroke={INK} strokeWidth="2.5" />
      {!worn ? (
        <g>
          <path d="M20 76 C 18 40, 40 22, 60 22 C 80 22, 102 40, 100 76 Z" fill="#c8513d" stroke={INK} strokeWidth="2.5" />
          {[34, 46, 58].map(y => (
            <path key={y} d={`M${26 - (y - 34) * 0.1} ${y + 12} Q 60 ${y + 2}, ${94 + (y - 34) * 0.1} ${y + 12}`} stroke="#f3e2c2" strokeWidth="5" fill="none" />
          ))}
          {[30, 42, 54, 66, 78, 90].map(x => (
            <path key={x} d={`M${x} 34 l 3 6 l 3 -6`} stroke="#9e3a2b" strokeWidth="1.6" fill="none" transform={`translate(-3 ${Math.abs(60 - x) * 0.35})`} />
          ))}
          <circle cx="60" cy="19" r="8" fill="#f3e2c2" stroke={INK} strokeWidth="2" />
        </g>
      ) : (
        <g>
          <circle cx="60" cy="54" r="5" fill="#d9ccb3" stroke={INK} strokeWidth="2" />
          <path d="M28 58 Q 60 44, 92 58" stroke={INK} strokeWidth="2" fill="none" />
        </g>
      )}
    </svg>
  );
}

/** The tea cosy on a hand: an excellent, oversized oven glove. */
export function KnitGlove() {
  return (
    <svg viewBox="0 0 90 100" role="img" aria-label="Tea cosy, worn as a glove">
      <path d="M22 92 L 20 50 C 18 30, 30 14, 46 14 C 62 14, 72 28, 70 48 L 74 44 C 80 38, 88 44, 84 52 L 70 70 L 68 92 Z" fill="#c8513d" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      {[34, 48, 62, 76].map(y => (
        <path key={y} d={`M22 ${y} Q 45 ${y - 6}, 70 ${y}`} stroke="#f3e2c2" strokeWidth="5" fill="none" />
      ))}
      <rect x="18" y="86" width="54" height="10" rx="4" fill="#f3e2c2" stroke={INK} strokeWidth="2" />
    </svg>
  );
}

export function Pumpkin() {
  return (
    <svg viewBox="0 0 140 90" role="img" aria-label="A pumpkin">
      <ellipse cx="70" cy="84" rx="58" ry="6" fill="rgba(0,0,0,0.18)" />
      {[
        [40, 26],
        [100, 26],
        [70, 34],
      ].map(([cx, rx]) => (
        <ellipse key={cx} cx={cx} cy="56" rx={rx} ry="28" fill="#e2852f" stroke={INK} strokeWidth="2.5" />
      ))}
      <path d="M70 30 C 68 20, 72 14, 78 10" stroke="#5e7d2c" strokeWidth="6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Quill({ inked = false }: { inked?: boolean }) {
  return (
    <svg viewBox="0 0 120 30" role="img" aria-label={inked ? "An inked quill" : "A shed quill"}>
      <path d="M6 15 L 96 11 L 114 15 L 96 19 Z" fill="#f2e6cc" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {[24, 40, 56, 72, 88].map(x => (
        <path key={x} d={`M${x} 13.2 L ${x + 6} 16.8`} stroke="#6b4b2e" strokeWidth="2.4" />
      ))}
      <path d="M96 11 L 114 15 L 96 19 Z" fill={inked ? "#1d2440" : "#3b2a1c"} />
      {inked ? <circle cx="116" cy="20" r="2.4" fill="#1d2440" /> : null}
    </svg>
  );
}

export function Inkwell() {
  return (
    <svg viewBox="0 0 80 80" role="img" aria-label="An ink well">
      <ellipse cx="40" cy="74" rx="30" ry="5" fill="rgba(0,0,0,0.2)" />
      <path d="M14 70 L 18 38 C 19 30, 61 30, 62 38 L 66 70 Z" fill="#9fb7c9" fillOpacity="0.75" stroke={INK} strokeWidth="2.5" />
      <path d="M17 50 L 63 50 L 65 69 L 15 69 Z" fill="#1d2440" />
      <rect x="28" y="20" width="24" height="12" rx="3" fill="#a87b4f" stroke={INK} strokeWidth="2.5" />
      <path d="M22 40 Q 26 36, 30 40" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" fill="none" />
    </svg>
  );
}

/** Hazel's writing table: her complaint, an ordinary pen, the acorn stamp. The ink spot lands where it lands. */
export function WritingTable({ inkSpot, stamped }: { inkSpot: boolean; stamped: boolean }) {
  return (
    <svg viewBox="0 0 220 130" role="img" aria-label="Hazel's writing table">
      <ellipse cx="110" cy="124" rx="96" ry="6" fill="rgba(0,0,0,0.2)" />
      <path d="M30 60 L 34 122 M190 60 L 186 122 M70 66 L 72 118 M150 66 L 148 118" stroke="#6b4b2e" strokeWidth="7" strokeLinecap="round" />
      <path d="M12 46 L 208 46 L 198 66 L 22 66 Z" fill="#a8774a" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 46 L 208 46 L 208 52 L 12 52 Z" fill="#c08f5f" />
      {/* the complaint, a little crooked */}
      <g transform="rotate(-6 80 40)">
        <rect x="52" y="14" width="58" height="36" fill="#fbf5e8" stroke={INK} strokeWidth="1.8" />
        {[22, 28, 34, 40].map(y => (
          <path key={y} d={`M58 ${y} L ${104 - (y % 3) * 4} ${y}`} stroke="#8b7a66" strokeWidth="1.4" />
        ))}
        {inkSpot ? <path d="M92 34 c 4 -3 9 -1 8 3 c 4 1 3 7 -2 6 c -2 4 -8 3 -8 -1 c -4 0 -4 -6 2 -8 z" fill="#1d2440" /> : null}
        {stamped ? (
          <g transform="rotate(-14 66 38)">
            <circle cx="66" cy="38" r="8" fill="none" stroke="#b2342b" strokeWidth="2" />
            <path d="M62 37 C 62 33, 70 33, 70 37 L 66 43 Z" fill="#b2342b" />
          </g>
        ) : null}
      </g>
      {/* an ordinary pen */}
      <path d="M128 40 L 168 30" stroke="#2c4a7a" strokeWidth="4" strokeLinecap="round" />
      <path d="M168 30 L 174 28.5" stroke="#d8d0c0" strokeWidth="4" strokeLinecap="round" />
      {/* the acorn stamp */}
      <g transform="translate(176 22)">
        <rect x="-6" y="10" width="12" height="12" rx="2" fill="#6b4b2e" stroke={INK} strokeWidth="1.8" />
        <path d="M-9 10 C -9 0, 9 0, 9 10 Z" fill="#8a5a33" stroke={INK} strokeWidth="1.8" />
        <path d="M-9 6 L 9 6" stroke="#5a3a20" strokeWidth="2.4" />
      </g>
    </svg>
  );
}

/** A folded card, the unfinished conversation the player carries. */
export function FoldedCard({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 120 80" role="img" aria-label={`A folded card: ${name}`}>
      <path d="M8 18 L 112 10 L 116 66 L 12 72 Z" fill="#fbf5e8" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M10 44 L 114 38" stroke="#c9bba3" strokeWidth="1.5" />
      <text x="62" y="31" textAnchor="middle" fontFamily="Caveat, cursive" fontSize="17" fill={INK} transform="rotate(-4 62 31)">
        {name}
      </text>
    </svg>
  );
}
