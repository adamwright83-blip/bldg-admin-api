/**
 * Slice 7: let a real, already-recorded outcome reshape the fiction
 * truthfully. Consumes the existing GoldlineVisitEvidence outcome
 * classification (shared/goldlineProgression.ts) — never invents a status
 * this codebase doesn't already know how to record. A negative real outcome
 * (rejection) closes the obvious route and opens a different one; it is
 * never treated as a win, and the chapter never becomes uncompletable
 * because of it. An ambiguous/unresolved real state stays ambiguous — no
 * optimism is manufactured to keep the story moving.
 */
import type { GoldlineVisitEvidence } from "../../shared/goldlineProgression";

export type RealOutcome = GoldlineVisitEvidence["outcome"] | null;
export type FictionBranch = "route_open" | "alternate_route_open" | "ambiguous_hold";

export function branchFictionFromRealOutcome(outcome: RealOutcome): {
  outcome: RealOutcome;
  branch: FictionBranch;
} {
  if (outcome === "won") return { outcome, branch: "route_open" };
  if (outcome === "lost") return { outcome, branch: "alternate_route_open" };
  return { outcome, branch: "ambiguous_hold" };
}

/**
 * Terminal real outcomes ('won'/'lost') never get overwritten by a later,
 * less-resolved signal — a closed prospect stays closed even if a stale
 * 'follow_up' event arrives after it. Two different terminal outcomes for
 * the same real prospect should not happen; if it ever does, the first
 * recorded terminal outcome is kept rather than silently flip-flopping the
 * story.
 */
export function applyRealOutcome(previous: RealOutcome, next: RealOutcome): RealOutcome {
  if (previous === "won" || previous === "lost") return previous;
  return next;
}
