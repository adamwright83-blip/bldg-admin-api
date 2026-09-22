import { memo, useId, type CSSProperties } from "react";
import { CLOCKHEAD_DEFERRALS } from "./colosseumStage";

/**
 * Clockhead / Vellum Kai, drawn from canon rather than borrowed art
 * (WORLD_BIBLE §14; VISUAL_MOTION_RULEBOOK "Clockhead"): an astronomical clock
 * of bronze and stone, concentric moving rings, some faces with no hands,
 * readable instantly as a clock at silhouette scale.
 *
 * His hands stand at one minute to the hour and tremble there — nothing may
 * happen before the correct time, and the correct time never arrives. When he
 * is finally beaten, the minute hand clicks onto the hour.
 *
 * Every ring is its own layer so that its rotation is a compositor transform,
 * never a repaint. The component is purely presentational: it draws whatever
 * state it is handed and decides nothing.
 */

export type ConstructMood =
  | "idle"
  | "tell"
  | "attack"
  | "exposed"
  | "break"
  | "defeated"
  | "disrupted";

export type ConstructSeal = { legend: string; broken: boolean };

export type ClockheadConstructProps = {
  variant: "hologram" | "solid";
  mood: ConstructMood;
  /** Accumulated ring rotation in degrees; the caller owns the tempo. */
  spin: number;
  /** 0..1, how charged the current wind-up is. */
  charge?: number;
  /** Clock-degrees (0 = twelve, clockwise) for the minute hand, if it is doing something. */
  minuteHand?: number | null;
  /** Clock-degrees for the hour hand, if it is aiming at something. */
  hourHand?: number | null;
  /** 0..1 damage taken. Cracks appear at thirds. */
  damage?: number;
  /** A white flash on a landed hit. */
  flash?: boolean;
  /** Real-progress seals, read-only. Omitted in the finale. */
  seals?: readonly ConstructSeal[];
  /** Index of a seal breaking right now, for its one-off animation. */
  breakingSeal?: number | null;
  /** 0..1 — how solid his projection has become (hologram only). */
  signal?: number;
  className?: string;
};

const TAU = Math.PI * 2;

function polar(radius: number, clockDegrees: number) {
  const radians = ((clockDegrees - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

function arc(radius: number, from: number, to: number): string {
  const a = polar(radius, from);
  const b = polar(radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const OUTER_SEGMENTS = Array.from({ length: 8 }, (_, index) => {
  const from = index * 45 + 3.5;
  return { from, to: from + 38 };
});

const TICKS = Array.from({ length: 60 }, (_, index) => {
  const hour = index % 5 === 0;
  const inner = polar(hour ? 63.5 : 67.5, index * 6);
  const outer = polar(71, index * 6);
  return { hour, inner, outer };
});

const INDICES = Array.from({ length: 12 }, (_, index) => index * 30);

const SPIRAL = (() => {
  const turns = 5;
  const points: string[] = [];
  for (let step = 0; step <= 220; step += 1) {
    const t = step / 220;
    const angle = t * turns * TAU;
    const radius = 4 + t * 40;
    points.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M ${points.join(" L ")}`;
})();

const LEGEND_TEXT = `${CLOCKHEAD_DEFERRALS.join(" · ")} · `;

/** Cracks by severity: each third of his health adds one set. */
const CRACKS = [
  "M -8 -70 L -4 -52 L -12 -40 L -6 -24 M -4 -52 L 6 -46",
  "M 58 34 L 44 26 L 38 36 L 22 30 L 12 40 M 44 26 L 48 12 M 66 -18 L 54 -14 L 50 -2",
  "M -60 30 L -44 22 L -40 40 L -24 44 L -18 60 M -44 22 L -52 8 M -30 -62 L -22 -48 L -32 -36 L -26 -20 M 20 62 L 16 48 L 26 40",
];

function sealAngle(index: number, count: number): number {
  // Spread across the upper three-quarters of the rim, leaving the bottom
  // (where he lowers himself to wind) clear.
  if (count <= 1) return 0;
  return -120 + (240 / (count - 1)) * index;
}

function ClockheadConstructImpl({
  variant,
  mood,
  spin,
  charge = 0,
  minuteHand = null,
  hourHand = null,
  damage = 0,
  flash = false,
  seals,
  breakingSeal = null,
  signal = 1,
  className = "",
}: ClockheadConstructProps) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  const exposed = mood === "exposed";
  const defeated = mood === "defeated";
  // The correct time finally arrives only in defeat.
  const minute = defeated ? 360 : minuteHand ?? 354 + Math.sin(spin * 0.9) * 0.9;
  const hour = defeated ? 360 : hourHand ?? 359.5;
  const cracks = damage >= 0.9 ? 3 : damage >= 0.6 ? 2 : damage >= 0.3 ? 1 : 0;

  const style = {
    "--cc-charge": charge.toFixed(3),
    "--cc-signal": signal.toFixed(3),
  } as CSSProperties;

  const layer = (rotation: number): CSSProperties => ({
    transform: `rotate(${rotation.toFixed(2)}deg)`,
  });

  return (
    <div
      className={`clockhead-construct is-${variant} is-${mood}${flash ? " is-flash" : ""}${
        className ? ` ${className}` : ""
      }`}
      style={style}
      aria-hidden="true"
    >
      <svg width="0" height="0" className="cc-defs" focusable="false">
        <defs>
          <linearGradient id={id("bronze")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4a2d10" />
            <stop offset="0.28" stopColor="#8d5b22" />
            <stop offset="0.47" stopColor="#dca54c" />
            <stop offset="0.53" stopColor="#fff0bd" />
            <stop offset="0.66" stopColor="#b77c2e" />
            <stop offset="1" stopColor="#57380f" />
          </linearGradient>
          <linearGradient id={id("bronze-soft")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2cb78" />
            <stop offset="0.5" stopColor="#b98232" />
            <stop offset="1" stopColor="#6d4516" />
          </linearGradient>
          <linearGradient id={id("stone")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbf6ea" />
            <stop offset="0.55" stopColor="#e9dfca" />
            <stop offset="1" stopColor="#cbbd9f" />
          </linearGradient>
          <radialGradient id={id("marble")} cx="0.42" cy="0.36" r="0.72">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="0.6" stopColor="#f1eadc" />
            <stop offset="1" stopColor="#d3c7b0" />
          </radialGradient>
          <radialGradient id={id("core")} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#fffbe0" />
            <stop offset="0.35" stopColor="#ffd46a" />
            <stop offset="0.75" stopColor="#e27a1f" />
            <stop offset="1" stopColor="#7a300c" />
          </radialGradient>
          <radialGradient id={id("core-open")} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#a8fbff" />
            <stop offset="1" stopColor="#1b8fa6" />
          </radialGradient>
          <path id={id("legend")} d="M 0 -86 A 86 86 0 1 1 -0.01 -86" />
        </defs>
      </svg>

      <div className="cc-rays" />
      <div className="cc-aura" />
      <div className="cc-shadow" />

      {/* Outer bronze ring: eight segments with amber slots, turning slowly. */}
      <svg className="cc-layer cc-outer" viewBox="-120 -120 240 240" style={layer(spin * 0.35)}>
        {OUTER_SEGMENTS.map((segment, index) => (
          <g key={index} className="cc-segment" style={{ "--cc-i": index } as CSSProperties}>
            <path d={arc(100, segment.from, segment.to)} stroke={url("bronze")} strokeWidth="13" fill="none" strokeLinecap="butt" />
            <path d={arc(106.2, segment.from, segment.to)} stroke="#3b230c" strokeOpacity="0.55" strokeWidth="1.2" fill="none" />
            <path d={arc(93.8, segment.from, segment.to)} stroke="#fff3c9" strokeOpacity="0.55" strokeWidth="0.9" fill="none" />
            <path className="cc-slot" d={arc(100, segment.from + 9, segment.to - 9)} strokeWidth="3.2" fill="none" strokeLinecap="round" />
            {[segment.from + 3, segment.to - 3].map(at => {
              const rivet = polar(100, at);
              return <circle key={at} cx={rivet.x} cy={rivet.y} r="1.8" fill="#fff0bd" stroke="#5a3a12" strokeWidth="0.6" />;
            })}
          </g>
        ))}
      </svg>

      {/* Stone ring engraved with every word he uses instead of "now". */}
      <svg className="cc-layer cc-legend" viewBox="-120 -120 240 240" style={layer(-spin * 0.22)}>
        <circle r="86" fill="none" stroke={url("stone")} strokeWidth="13.5" />
        <circle r="92.6" fill="none" stroke={url("bronze")} strokeWidth="1.6" />
        <circle r="79.4" fill="none" stroke={url("bronze")} strokeWidth="1.6" />
        <text className="cc-legend-text" dy="2.5">
          <textPath href={`#${id("legend")}`} textLength="536" lengthAdjust="spacing">
            {LEGEND_TEXT}
          </textPath>
        </text>
      </svg>

      {/* Bezel, marble dial, indices, sub-dials. */}
      <svg className="cc-layer cc-body" viewBox="-120 -120 240 240">
        <circle r="75.5" fill="none" stroke={url("bronze")} strokeWidth="7" />
        <circle r="71.6" fill={url("marble")} />
        <g className="cc-face-detail">
          <path d="M -60 -28 C -40 -20 -30 -34 -12 -26 S 16 -8 30 -16" stroke="#9a8c74" strokeOpacity="0.22" strokeWidth="0.7" fill="none" />
          <path d="M -44 38 C -26 30 -10 44 8 36 S 40 46 56 30" stroke="#9a8c74" strokeOpacity="0.18" strokeWidth="0.6" fill="none" />
          <path d="M 18 -60 C 24 -44 14 -30 22 -16" stroke="#9a8c74" strokeOpacity="0.16" strokeWidth="0.5" fill="none" />
          {TICKS.map((tick, index) => (
            <line
              key={index}
              x1={tick.inner.x}
              y1={tick.inner.y}
              x2={tick.outer.x}
              y2={tick.outer.y}
              stroke={tick.hour ? "#6f4a1b" : "#8f7a58"}
              strokeWidth={tick.hour ? 1.6 : 0.7}
            />
          ))}
          {INDICES.map(degrees => (
            <g key={degrees} transform={`rotate(${degrees})`}>
              <rect x="-2.3" y="-60" width="4.6" height="13" rx="1" fill={url("bronze-soft")} stroke="#5a3a12" strokeWidth="0.5" />
              {degrees === 0 && (
                <rect x="-2.3" y="-60" width="4.6" height="13" rx="1" fill={url("bronze-soft")} stroke="#5a3a12" strokeWidth="0.5" transform="translate(6.5 0)" />
              )}
            </g>
          ))}
          {/* Three sub-dials. Two of them have no hands at all. */}
          {[
            { x: 0, y: -31, r: 11.5, hand: true },
            { x: 27, y: 17, r: 10.5, hand: false },
            { x: -27, y: 17, r: 10.5, hand: false },
          ].map((dial, index) => (
            <g key={index} transform={`translate(${dial.x} ${dial.y})`}>
              <circle r={dial.r} fill="#f7f1e4" stroke={url("bronze")} strokeWidth="1.6" />
              {Array.from({ length: 12 }, (_, tick) => {
                const inner = polar(dial.r - 3, tick * 30);
                const outer = polar(dial.r - 1.2, tick * 30);
                return <line key={tick} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#8f7a58" strokeWidth="0.6" />;
              })}
              {dial.hand && (
                <line
                  className="cc-subhand"
                  x1="0"
                  y1="1.5"
                  x2="0"
                  y2={-dial.r + 3}
                  stroke="#5a3a12"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  transform={`rotate(${(spin * 14) % 360})`}
                />
              )}
              <circle r="1.3" fill="#5a3a12" />
            </g>
          ))}
          {CRACKS.slice(0, cracks).map((crack, index) => (
            <path key={index} className="cc-crack" d={crack} />
          ))}
        </g>
      </svg>

      {/* Astrolabe rete, turning against the face. */}
      <svg className="cc-layer cc-rete" viewBox="-120 -120 240 240" style={layer(spin * 0.6)}>
        <circle cx="0" cy="9" r="41" fill="none" stroke="#9c6a26" strokeOpacity="0.55" strokeWidth="1.3" />
        <circle cx="0" cy="-6" r="26" fill="none" stroke="#9c6a26" strokeOpacity="0.4" strokeWidth="0.9" />
        {[20, 95, 160, 230, 300].map((at, index) => {
          const tip = polar(38 + (index % 2) * 7, at);
          const left = polar(30, at - 6);
          const right = polar(30, at + 6);
          return <path key={at} d={`M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`} fill="#c08a3a" fillOpacity="0.55" />;
        })}
      </svg>

      {/* The mainspring: hidden behind the dial until he has to wind himself. */}
      <svg className="cc-layer cc-mainspring" viewBox="-120 -120 240 240" style={layer(-spin * 1.4)}>
        <path d={SPIRAL} fill="none" strokeWidth="2.3" strokeLinecap="round" />
      </svg>

      <svg className="cc-layer cc-hand cc-hand--hour" viewBox="-120 -120 240 240" style={layer(hour)}>
        <path d="M 0 -40 L 5.5 -22 L 3 8 L -3 8 L -5.5 -22 Z" fill={url("bronze")} stroke="#3f260c" strokeWidth="1" />
      </svg>
      <svg className="cc-layer cc-hand cc-hand--minute" viewBox="-120 -120 240 240" style={layer(minute)}>
        <path d="M 0 -66 L 3.2 -54 L 2 -40 L 3.6 -4 L 0 14 L -3.6 -4 L -2 -40 L -3.2 -54 Z" fill={url("bronze")} stroke="#3f260c" strokeWidth="0.9" />
        <circle cy="12" r="4.4" fill={url("bronze")} stroke="#3f260c" strokeWidth="0.8" />
      </svg>

      <svg className="cc-layer cc-hub" viewBox="-120 -120 240 240">
        <circle r="11" fill={url("bronze")} stroke="#3f260c" strokeWidth="1" />
        <circle r="7.6" fill="#3a230b" />
        <circle className="cc-core" r="5.6" fill={url(exposed ? "core-open" : "core")} />
      </svg>

      {seals && seals.length > 0 && (
        <svg className="cc-layer cc-seals" viewBox="-120 -120 240 240">
          {seals.map((seal, index) => {
            const at = sealAngle(index, seals.length);
            const breaking = breakingSeal === index;
            const shown = seal.broken && !breaking;
            return (
              <g
                key={`${seal.legend}-${index}`}
                transform={`rotate(${at}) translate(0 -104)`}
                className={`cc-seal${shown ? " is-broken" : ""}${breaking ? " is-breaking" : ""}`}
              >
                <g transform={`rotate(${-at})`}>
                  <path className="cc-seal-shackle" d="M -6.5 -5 L -6.5 -11 A 6.5 6.5 0 0 1 6.5 -11 L 6.5 -5" fill="none" strokeWidth="3.2" />
                  <rect className="cc-seal-plate" x="-10" y="-6" width="20" height="17" rx="3.5" />
                  <circle className="cc-seal-keyhole" cy="1.5" r="2.6" />
                  <path className="cc-seal-crack" d="M -3 -6 L 1 0 L -2 4 L 2 11" fill="none" />
                </g>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export const ClockheadConstruct = memo(ClockheadConstructImpl);
