/**
 * Cloud guardian, drawn from the approved artwork.
 *
 * WHY THIS STOPPED BEING SVG
 *
 * These were hand-rolled SVG cloud shapes standing in for art that already
 * existed. On the territory board they read as black-and-white blobs — the
 * ugliest objects on the screen — while the approved sheet with all six
 * characters sat in the repo, referenced by nothing.
 *
 * The portraits below are cut from that sheet
 * (`guardians/approved-asset-sheet.png`, seam-carved apart along the gaps
 * between figures, alpha cleaned, no label plates). Nothing was redrawn or
 * regenerated: this is the approved art, separated.
 *
 * They remain ACTORS, not stills. Phase, defeat and ghost states are still
 * carried by classes on the wrapper, and `--look-x` / `--look-y` still steer
 * the figure — as a small parallax drift rather than as moving eyeballs, which
 * is the one thing the SVG could do that a portrait cannot.
 */

import type { CSSProperties } from "react";
import type { GuardianDefinition, GuardianId } from "@shared/goldlineGuardians";
import { guardianById } from "@shared/goldlineGuardians";
import type { GuardianPhase } from "@shared/goldlineGuardianEngine";

/**
 * The cut portraits, keyed by the same ids `shared/goldlineGuardians.ts`
 * defines. A guardian with no portrait renders nothing rather than a
 * substitute, so a missing cut is visible instead of silently wrong.
 */
const GUARDIAN_ART: Record<string, string> = {
  thunder_king: "/assets/goldline/guardians/v1/thunder_king.png",
  cloud_duchess: "/assets/goldline/guardians/v1/cloud_duchess.png",
  sleepy_one_eye: "/assets/goldline/guardians/v1/sleepy_one_eye.png",
  tiny_emperor: "/assets/goldline/guardians/v1/tiny_emperor.png",
  gust_jester: "/assets/goldline/guardians/v1/gust_jester.png",
  drizzle_detective: "/assets/goldline/guardians/v1/drizzle_detective.png",
};

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
      {GUARDIAN_ART[guardian.id] ? (
        <img
          className="gl-guardian-art"
          src={GUARDIAN_ART[guardian.id]}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}
      <span className="gl-guardian-wisps" />
    </div>
  );
}

export function guardianAriaLabel(guardian: GuardianDefinition, phase: string) {
  return `${guardian.name}, ${guardian.epithet}. ${guardian.reducedMotionFallback} Currently ${phase.replace(/_/g, " ")}.`;
}
