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
      <ellipse cx="80" cy="92" rx="48" ry="36" className="cloud-body" />
      <ellipse cx="52" cy="78" rx="22" ry="18" className="cloud-puff" />
      <ellipse cx="110" cy="80" rx="24" ry="20" className="cloud-puff" />
      <path d="M58 44 l12 18 h-9 l14 20 -18 -16 h10 z" className="gold-prop crown" />
      <circle cx="64" cy="74" r="7" className="eye-white" />
      <circle cx="96" cy="74" r="7" className="eye-white" />
      <circle cx="64" cy="74" r="3.2" className="eye-pupil" />
      <circle cx="96" cy="74" r="3.2" className="eye-pupil" />
      <path d="M60 90 q20 16 40 0" className="mouth roar" />
      <ellipse cx="28" cy="108" rx="16" ry="14" className="cloud-fist" />
      <ellipse cx="132" cy="104" rx="18" ry="15" className="cloud-fist" />
      <path d="M132 86 l8 22" className="gold-prop bolt" />
    </g>
  );
}

function CloudDuchessMark() {
  return (
    <g className="mark-duchess">
      <ellipse cx="80" cy="108" rx="30" ry="38" className="cloud-body dress" />
      <ellipse cx="80" cy="70" rx="22" ry="28" className="cloud-body face" />
      <ellipse cx="80" cy="38" rx="28" ry="22" className="cloud-puff hair" />
      <ellipse cx="58" cy="42" rx="14" ry="16" className="cloud-puff hair" />
      <ellipse cx="104" cy="40" rx="14" ry="18" className="cloud-puff hair" />
      <path d="M68 28 q12 -14 24 0" className="gold-prop tiara" />
      <circle cx="72" cy="68" r="4.5" className="eye-white" />
      <circle cx="90" cy="68" r="4.5" className="eye-white" />
      <circle cx="72" cy="68" r="2" className="eye-pupil" />
      <circle cx="90" cy="68" r="2" className="eye-pupil" />
      <path d="M74 82 q6 4 12 0" className="mouth smug" />
      <path d="M108 70 q28 -18 36 12 q-22 8 -34 4" className="gold-prop parasol" />
      <line x1="118" y1="78" x2="126" y2="118" className="gold-prop stem" />
    </g>
  );
}

function SleepyOneEyeMark() {
  return (
    <g className="mark-sleepy">
      <ellipse cx="80" cy="96" rx="58" ry="42" className="cloud-body colossus" />
      <ellipse cx="40" cy="108" rx="20" ry="16" className="cloud-puff" />
      <ellipse cx="122" cy="100" rx="18" ry="22" className="cloud-puff hand" />
      <ellipse cx="80" cy="72" rx="22" ry="18" className="eye-white huge" />
      <path d="M58 70 q22 18 44 0" className="lid" />
      <circle cx="80" cy="76" r="6" className="eye-pupil huge" />
      <path d="M70 98 q10 10 20 2" className="mouth snore" />
      <circle cx="64" cy="48" r="4" className="bird" />
      <circle cx="80" cy="42" r="3.5" className="bird two" />
      <circle cx="96" cy="50" r="3.2" className="bird three" />
    </g>
  );
}

function TinyEmperorMark() {
  return (
    <g className="mark-emperor">
      <rect x="48" y="78" width="64" height="40" rx="8" className="gold-prop throne" />
      <ellipse cx="38" cy="70" rx="16" ry="22" className="cloud-fist command" />
      <ellipse cx="122" cy="70" rx="16" ry="22" className="cloud-fist command" />
      <ellipse cx="80" cy="70" rx="14" ry="12" className="cloud-body tiny" />
      <path d="M74 56 l6 8 6 -8" className="gold-prop micro-crown" />
      <circle cx="76" cy="68" r="2.2" className="eye-white" />
      <circle cx="84" cy="68" r="2.2" className="eye-white" />
      <circle cx="76" cy="68" r="1.1" className="eye-pupil" />
      <circle cx="84" cy="68" r="1.1" className="eye-pupil" />
      <path d="M76 76 l8 2" className="mouth shout" />
      <line x1="88" y1="72" x2="102" y2="58" className="gold-prop scepter" />
    </g>
  );
}

function GustJesterMark() {
  return (
    <g className="mark-jester">
      <ellipse cx="80" cy="96" rx="28" ry="32" className="cloud-body lanky" />
      <path d="M52 48 q28 -28 56 0 q-10 16 -28 10 q-18 8 -28 -10" className="gold-prop cap" />
      <circle cx="50" cy="50" r="5" className="gold-prop bell" />
      <circle cx="110" cy="50" r="5" className="gold-prop bell" />
      <circle cx="68" cy="78" r="6" className="eye-white" />
      <circle cx="92" cy="78" r="6" className="eye-white" />
      <circle cx="70" cy="80" r="2.6" className="eye-pupil" />
      <circle cx="90" cy="76" r="2.6" className="eye-pupil" />
      <path d="M64 94 q16 14 32 0" className="mouth grin" />
      <ellipse cx="44" cy="118" rx="10" ry="8" className="cloud-puff" />
      <ellipse cx="116" cy="112" rx="12" ry="9" className="cloud-puff" />
    </g>
  );
}

function DrizzleDetectiveMark() {
  return (
    <g className="mark-detective">
      <ellipse cx="80" cy="100" rx="34" ry="30" className="cloud-body coat" />
      <path d="M52 58 h56 l-8 18 h-40 z" className="cloud-puff hat" />
      <path d="M60 58 q20 -16 40 0" className="gold-prop brim" />
      <circle cx="70" cy="78" r="5" className="eye-white" />
      <circle cx="90" cy="78" r="5" className="eye-white" />
      <circle cx="70" cy="78" r="2.2" className="eye-pupil" />
      <circle cx="90" cy="78" r="2.2" className="eye-pupil" />
      <path d="M74 90 q6 2 12 -2" className="mouth mutter" />
      <circle cx="118" cy="86" r="12" className="gold-prop glass" fill="none" />
      <line x1="126" y1="94" x2="138" y2="108" className="gold-prop glass" />
      <circle cx="64" cy="128" r="3" className="drop" />
      <circle cx="80" cy="134" r="2.4" className="drop" />
      <circle cx="96" cy="130" r="3.2" className="drop" />
    </g>
  );
}
