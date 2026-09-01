/**
 * Procedural cloud guardian.
 *
 * These are animated actors, not portraits. Silhouettes follow the approved
 * Goldline guardian sheet: Thunder King, Cloud Duchess, Sleepy One-Eye,
 * Tiny Emperor, Gust Jester, Drizzle Detective.
 */

import type { CSSProperties } from "react";
import type { GuardianDefinition, GuardianId } from "@shared/goldlineGuardians";
import { guardianById } from "@shared/goldlineGuardians";
import type { GuardianPhase } from "@shared/goldlineGuardianEngine";

export function GuardianActor({
  guardianId,
  phase,
  lookX = 0,
  lookY = 0,
  reducedMotion = false,
  defeated = false,
  clearedGhost = false,
  scale = 1,
}: {
  guardianId: GuardianId | string;
  phase: GuardianPhase | "ghost";
  lookX?: number;
  lookY?: number;
  reducedMotion?: boolean;
  defeated?: boolean;
  clearedGhost?: boolean;
  scale?: number;
}) {
  const guardian = guardianById(guardianId);
  const eyeX = Math.max(-6, Math.min(6, lookX * 6));
  const eyeY = Math.max(-4, Math.min(4, lookY * 4));
  return (
    <div
      className={`gl-guardian is-${guardian.id} is-${phase}${defeated ? " is-defeated" : ""}${clearedGhost ? " is-ghost" : ""}${reducedMotion ? " is-reduced" : ""}`}
      data-testid={`goldline-guardian-${guardian.id}`}
      data-guardian-phase={phase}
      style={{
        "--look-x": `${eyeX}px`,
        "--look-y": `${eyeY}px`,
        "--guardian-scale": String(scale * guardian.silhouette.bodyScale),
      } as CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 160 160" className="gl-guardian-svg" role="presentation">
        {guardian.id === "tiny_emperor" ? <TinyEmperorMark /> : null}
        {guardian.id === "thunder_king" ? <ThunderKingMark /> : null}
        {guardian.id === "cloud_duchess" ? <CloudDuchessMark /> : null}
        {guardian.id === "sleepy_one_eye" ? <SleepyOneEyeMark /> : null}
        {guardian.id === "gust_jester" ? <GustJesterMark /> : null}
        {guardian.id === "drizzle_detective" ? <DrizzleDetectiveMark /> : null}
      </svg>
      <span className="gl-guardian-wisps" />
    </div>
  );
}

export function guardianAriaLabel(guardian: GuardianDefinition, phase: string) {
  return `${guardian.name}, ${guardian.epithet}. ${guardian.reducedMotionFallback} Currently ${phase.replace(/_/g, " ")}.`;
}

function ThunderKingMark() {
  return (
    <g className="mark-thunder">
      <ellipse cx="80" cy="96" rx="52" ry="38" className="cloud-body" />
      <ellipse cx="46" cy="78" rx="24" ry="20" className="cloud-puff" />
      <ellipse cx="116" cy="80" rx="26" ry="22" className="cloud-puff" />
      <path d="M62 34 l10 16 h-8 l16 22 -20 -18 h11 z" className="gold-prop crown" />
      <path d="M54 62 l16 6 -14 5" className="gold-prop brow" />
      <path d="M106 62 l-16 6 14 5" className="gold-prop brow" />
      <circle cx="62" cy="76" r="8" className="eye-white" />
      <circle cx="98" cy="76" r="8" className="eye-white" />
      <circle cx="62" cy="76" r="3.6" className="eye-pupil" />
      <circle cx="98" cy="76" r="3.6" className="eye-pupil" />
      <path d="M58 94 q22 20 44 0" className="mouth roar" />
      <ellipse cx="24" cy="112" rx="18" ry="16" className="cloud-fist" />
      <ellipse cx="136" cy="108" rx="20" ry="17" className="cloud-fist" />
      <rect x="18" y="118" width="14" height="5" rx="2" className="gold-prop band" />
      <rect x="128" y="114" width="16" height="5" rx="2" className="gold-prop band" />
      <path d="M134 82 l10 26" className="gold-prop bolt" />
    </g>
  );
}

function CloudDuchessMark() {
  return (
    <g className="mark-duchess">
      <ellipse cx="80" cy="118" rx="26" ry="34" className="cloud-body dress" />
      <ellipse cx="80" cy="72" rx="20" ry="30" className="cloud-body face" />
      <ellipse cx="80" cy="32" rx="32" ry="20" className="cloud-puff hair" />
      <ellipse cx="52" cy="40" rx="16" ry="20" className="cloud-puff hair" />
      <ellipse cx="108" cy="38" rx="16" ry="22" className="cloud-puff hair" />
      <path d="M68 22 q12 -12 24 0" className="gold-prop tiara" />
      <circle cx="72" cy="70" r="4.2" className="eye-white" />
      <circle cx="90" cy="70" r="4.2" className="eye-white" />
      <circle cx="72" cy="70" r="1.8" className="eye-pupil" />
      <circle cx="90" cy="70" r="1.8" className="eye-pupil" />
      <path d="M74 84 q6 3 12 0" className="mouth smug" />
      <path d="M112 64 q32 -22 40 18 q-24 10 -38 4" className="gold-prop parasol" />
      <line x1="122" y1="78" x2="128" y2="124" className="gold-prop stem" />
      <ellipse cx="46" cy="108" rx="7" ry="11" className="cloud-puff hand" />
    </g>
  );
}

function SleepyOneEyeMark() {
  return (
    <g className="mark-sleepy">
      <ellipse cx="80" cy="104" rx="62" ry="38" className="cloud-body colossus" />
      <ellipse cx="34" cy="118" rx="22" ry="14" className="cloud-puff hand" />
      <ellipse cx="128" cy="108" rx="16" ry="24" className="cloud-puff" />
      <ellipse cx="80" cy="74" rx="28" ry="20" className="eye-white huge" />
      <path d="M54 68 q26 22 52 0" className="lid" fill="#d7c9a4" opacity="0.55" />
      <circle cx="80" cy="80" r="5.5" className="eye-pupil huge" />
      <path d="M70 102 q12 12 24 0" className="mouth snore" />
      <circle cx="60" cy="46" r="5" className="bird" />
      <circle cx="80" cy="38" r="4.2" className="bird two" />
      <circle cx="100" cy="48" r="3.8" className="bird three" />
    </g>
  );
}

function TinyEmperorMark() {
  return (
    <g className="mark-emperor">
      <ellipse cx="86" cy="108" rx="46" ry="28" className="cloud-fist command-throne" />
      <ellipse cx="48" cy="96" rx="14" ry="18" className="cloud-puff thumb" />
      <ellipse cx="28" cy="64" rx="20" ry="26" className="cloud-fist command" />
      <ellipse cx="80" cy="78" rx="11" ry="10" className="cloud-body tiny" />
      <path d="M74 66 l6 7 6 -7" className="gold-prop micro-crown" />
      <circle cx="77" cy="76" r="1.8" className="eye-white" />
      <circle cx="83" cy="76" r="1.8" className="eye-white" />
      <circle cx="77" cy="76" r="0.9" className="eye-pupil" />
      <circle cx="83" cy="76" r="0.9" className="eye-pupil" />
      <path d="M76 82 h8" className="mouth shout" />
      <line x1="88" y1="80" x2="104" y2="62" className="gold-prop scepter" />
      <circle cx="106" cy="60" r="3" className="gold-prop" />
    </g>
  );
}

function GustJesterMark() {
  return (
    <g className="mark-jester">
      <ellipse cx="80" cy="102" rx="24" ry="34" className="cloud-body lanky" />
      <path d="M48 58 q16 -36 32 -4 q16 -36 32 6 q-16 14 -32 4 q-16 14 -32 -6" className="gold-prop cap" />
      <circle cx="46" cy="56" r="6" className="gold-prop bell" />
      <circle cx="114" cy="58" r="6" className="gold-prop bell" />
      <circle cx="68" cy="82" r="6.5" className="eye-white" />
      <circle cx="92" cy="80" r="6.5" className="eye-white" />
      <circle cx="70" cy="84" r="2.8" className="eye-pupil" />
      <circle cx="90" cy="78" r="2.8" className="eye-pupil" />
      <path d="M62 96 q18 16 36 -2" className="mouth grin" />
      <ellipse cx="40" cy="128" rx="11" ry="8" className="cloud-puff" />
      <ellipse cx="120" cy="118" rx="13" ry="9" className="cloud-puff" />
    </g>
  );
}

function DrizzleDetectiveMark() {
  return (
    <g className="mark-detective">
      <ellipse cx="80" cy="104" rx="36" ry="28" className="cloud-body coat" />
      <path d="M54 62 h52 l-6 14 h-40 z" className="hat-crown" fill="#8b5a2b" stroke="#5a3a18" />
      <path d="M44 62 q36 -18 72 0" className="gold-prop brim" fill="none" />
      <path d="M50 62 h60" className="gold-prop brim" />
      <circle cx="70" cy="80" r="5" className="eye-white" />
      <circle cx="90" cy="80" r="5" className="eye-white" />
      <circle cx="70" cy="80" r="2.2" className="eye-pupil" />
      <circle cx="90" cy="80" r="2.2" className="eye-pupil" />
      <path d="M74 92 q6 2 12 -2" className="mouth mutter" />
      <path d="M86 94 q10 6 14 0" className="gold-prop pipe" fill="none" />
      <circle cx="120" cy="88" r="13" className="gold-prop glass" fill="none" />
      <line x1="130" y1="98" x2="142" y2="112" className="gold-prop glass" />
      <circle cx="62" cy="132" r="3.2" className="drop" />
      <circle cx="80" cy="138" r="2.6" className="drop" />
      <circle cx="98" cy="134" r="3.4" className="drop" />
    </g>
  );
}
