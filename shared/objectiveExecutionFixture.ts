/**
 * The same work, classified once.
 *
 * Weekly draft, locked WeeklyIntent, Daily Command, Admin Day Line,
 * Driver Day Line, and Claire read all use classifyObjectiveExecution on
 * these rows. The identifier is not evidence. Unknown stays null.
 */

import { classifyObjectiveExecution, type ObjectiveExecutionDecision, type ObjectiveExecutionType } from "./objectiveExecution";

export type ObjectiveExecutionAgreementCase = {
  id: string;
  contract: string;
  identifier: string;
  motion: string | null;
  expected: ObjectiveExecutionType | null;
};

export const OBJECTIVE_EXECUTION_AGREEMENT_CASES: readonly ObjectiveExecutionAgreementCase[] = [
  {
    id: "on-site-property-pitch",
    contract: "On-site property pitch",
    identifier: "commercial_mission:greystar",
    motion: "digital_presence",
    expected: "mission",
  },
  {
    id: "remote-follow-up",
    contract: "Remote follow-up with Dana",
    identifier: "weekly-mission-follow-up",
    motion: "commercial_follow_up",
    expected: "challenge",
  },
  {
    id: "website-visit",
    contract: "Visit the website",
    identifier: "mission-digital",
    motion: "digital_presence",
    expected: null,
  },
  {
    id: "visit-or-email",
    contract: "Visit OR email",
    identifier: "mission-either",
    motion: null,
    expected: null,
  },
  {
    id: "visit-and-email",
    contract: "Visit AND email",
    identifier: "mission-hybrid",
    motion: null,
    expected: "hybrid_objective",
  },
  {
    id: "word-mission",
    contract: "One real mission for Tuesday",
    identifier: "weekly-mission-readiness",
    motion: "account_acquisition",
    expected: null,
  },
];

/** Full evidence and contract-only evidence. Both shapes call the one classifier. */
export function classifyAgreementCase(row: ObjectiveExecutionAgreementCase): ObjectiveExecutionDecision {
  return classifyObjectiveExecution({
    contract: row.contract,
    completionCondition: row.contract,
    title: row.identifier,
    objective: row.contract,
    identifier: row.identifier,
    motion: row.motion,
  });
}
