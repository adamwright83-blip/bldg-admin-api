/**
 * Behavioral Ledger — Slice 1 (see docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md).
 *
 * Append-only record of what actually happened to a piece of real work, kept
 * separate from any interpretation of why. Observed behavior is recorded.
 * Interpretation is annotated elsewhere with provenance and a version.
 * Neither is ever allowed to become the other (see foundation doc, Permanent law).
 *
 * This is instrumentation only. It does not select interventions, diagnose
 * resistance, or score operators. It exists so that, later, a real
 * micro-randomized trial can be run over history that already exists.
 */

/**
 * Event names describe what Goldline can actually observe — never a
 * construct it cannot establish. See foundation doc §4.
 *
 * `EXPOSED` is deliberately absent. A server can prove `DELIVERED`. It
 * cannot prove the operator's attention without instrumentation we don't
 * have. `DEFERRED` requires an explicit operator act — it is never inferred
 * from mere non-completion (that's what NOT_COMPLETED / recovery is for).
 */
export const LEDGER_EVENT_TYPES = [
  "DELIVERED",
  "VIEWABLE",
  "ENGAGED",
  "ACCEPTED",
  "STARTED",
  "COMPLETED",
  "VERIFIED",
  "DEFERRED",
  "DISMISSED",
  "EXPIRED",
  "SUPERSEDED",
  "NOT_COMPLETED",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

/** The subsystem that authored this event. Correlates to, never duplicates, its own tables. */
export const LEDGER_SOURCE_SYSTEMS = [
  "ops_task",
  "strategy_path_offer",
  "commercial_mission",
  "mission_director",
  "campaign_run",
  "first_mission",
] as const;
export type LedgerSourceSystem = (typeof LEDGER_SOURCE_SYSTEMS)[number];

/**
 * Reuse of shared/businessGame.ts's VerificationClass. A ledger row about
 * COMPLETED work is never itself proof; VERIFIED status (or a later VERIFIED
 * event) is what upgrades it.
 */
export { VERIFICATION_CLASSES, type VerificationClass } from "./businessGame";

/**
 * MRT-readiness fields (foundation doc §5). These cannot be reconstructed
 * retroactively — if a decision point didn't preserve them when it happened,
 * that history is observational forever. Populated only on events that
 * represent an actual intervention-selection decision point; null otherwise.
 */
export type DecisionPointFields = {
  decisionPointId: string;
  /** Was the operator eligible/available for intervention at all. */
  availability: boolean;
  /** The option set considered, after safety/eligibility gating. */
  eligibleOptions: readonly string[];
  /** What was actually selected from eligibleOptions. */
  assignedOption: string;
  /** The randomization probability used to select assignedOption, when assignment was randomized. Null for deterministic/rule-based assignment. */
  assignmentProbability: number | null;
  /** Which selection policy made this assignment. */
  interventionPolicyVersion: number;
  /** Which annotation-registry version was in force for assignedOption. */
  interventionDefinitionVersion: number | null;
  /** Predefined before the outcome is known — never set after the fact. */
  proximalOutcomeWindowMinutes: number;
};

export type LedgerEventInput = {
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  sourceSystem: LedgerSourceSystem;
  sourceEntityType: string;
  sourceEntityId: string;
  eventType: LedgerEventType;
  occurredAt: Date;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED" | null;
  provenance: string;
  evidenceSource?: string | null;
  idempotencyKey: string;
  decisionPoint?: DecisionPointFields | null;
};
