/**
 * Shared interaction-affordance vocabulary for expedition world objects
 * (§PR77 Part 5).
 *
 * Before this file, every interactable invented its own private state name
 * and thresholds: relic plinths had `lit`, fork branches had `intensity`,
 * the climax seal had `tension`, grapple rings and hazards shared a
 * `propHighlight()` that nothing else used. A player who learned "bright
 * ring = can hook it" from one object had no reason to expect the same
 * rule applied to a relic plinth or a fork branch, because nothing said it
 * did — each was tuned independently by whoever authored that object.
 *
 * Every expedition interactable is now in exactly one of four states:
 *
 *   AT-REST   — an ordinary physical object. Nothing invites interaction.
 *   RELEVANT  — eligible right now (Line aiming, a choice is undecided).
 *   LOCKED    — the player has committed: a Line lock, a taken relic, a
 *               chosen fork branch, an active barrier.
 *   RESOLVED  — interaction is over: spent, superseded, dropped.
 *
 * Individual objects still choose their own pixels for each state (a relic
 * plinth's LOCKED glow is not required to look identical to a grapple
 * ring's) — what's shared is the STATE NAME and the rule that decides it,
 * so the vocabulary a player learns from one object transfers to the next.
 */

export type AffordanceState = "at-rest" | "relevant" | "locked" | "resolved";

export const AFFORDANCE_STATES: readonly AffordanceState[] = [
  "at-rest",
  "relevant",
  "locked",
  "resolved",
];

/**
 * A Line target prop — grapple ring or hazard anchor. Shared by every
 * `LineCandidateRegistry`-registered environment node, so a ring and a
 * suspended-cargo mooring point agree on what "relevant" and "locked" mean.
 */
export function lineTargetAffordanceState(params: {
  id: string;
  lockedTargetId: string | null;
  aiming: boolean;
}): AffordanceState {
  if (params.lockedTargetId === params.id) return "locked";
  if (params.aiming) return "relevant";
  return "at-rest";
}

/** Canonical highlight intensity for a Line target prop, keyed by state. */
export const LINE_TARGET_INTENSITY: Record<AffordanceState, number> = {
  "at-rest": 0,
  relevant: 0.55,
  locked: 1,
  resolved: 0,
};

/** A Relic plinth. LOCKED means this is the relic the player took; RESOLVED
 * means a different plinth was chosen and this one is spent. */
export function relicAffordanceState(params: {
  taken: boolean;
  decided: boolean;
}): AffordanceState {
  if (params.decided) return params.taken ? "locked" : "resolved";
  return "relevant";
}

/** A physical Safe/Upper fork branch. */
export function forkBranchAffordanceState(params: {
  branchTaken: boolean;
  undecided: boolean;
  scarred: boolean;
}): AffordanceState {
  if (params.scarred) return "resolved";
  if (params.branchTaken) return "locked";
  if (params.undecided) return "relevant";
  return "at-rest";
}

/** The Shieldbearer's climax barrier. It has no RELEVANT phase — the wall
 * is simply up (LOCKED: the player is committed to clearing it) or it has
 * come down (RESOLVED). */
export function climaxSealAffordanceState(params: { up: boolean }): AffordanceState {
  return params.up ? "locked" : "resolved";
}
