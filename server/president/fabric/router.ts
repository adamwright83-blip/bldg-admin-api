import type { ExecutionDomain } from "../../../shared/presidentCycle";

export type ExecutorKind = "ENGINEERING" | "RESEARCH";

/**
 * Execution router. President-owned executors only. There is intentionally no
 * route to any peer seat; unsupported domains block rather than fake success.
 */
export const DOMAIN_ROUTES: Partial<Record<ExecutionDomain, ExecutorKind>> = {
  ENGINEERING: "ENGINEERING",
  RESEARCH: "RESEARCH",
  ANALYSIS: "RESEARCH",
};

export const BLOCKED_UNSUPPORTED = "BLOCKED_UNSUPPORTED_EXECUTION_DOMAIN";

export function routeMission(domain: ExecutionDomain): ExecutorKind | typeof BLOCKED_UNSUPPORTED {
  return DOMAIN_ROUTES[domain] ?? BLOCKED_UNSUPPORTED;
}

/** Actor identities are President-owned. Anything resembling a peer seat is rejected. */
const FOREIGN_ACTOR = /mitch/i;

export function assertPresidentActor(actorId: string) {
  if (!actorId || FOREIGN_ACTOR.test(actorId))
    throw new Error(`Actor ${actorId} is not a President-owned actor`);
  if (!/^president-/.test(actorId))
    throw new Error(`Actor ${actorId} must be a president-* actor`);
}

export function assertIndependentReviewer(executorId: string, reviewerId: string) {
  assertPresidentActor(executorId);
  assertPresidentActor(reviewerId);
  if (executorId === reviewerId)
    throw new Error("Reviewer must not be the executor");
  // Same role family also forbidden: reviewers cannot be executors by naming.
  if (/executor/.test(reviewerId) || /reviewer/.test(executorId))
    throw new Error("Actor roles are crossed");
}
