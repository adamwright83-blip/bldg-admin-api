import { and, eq, inArray } from "drizzle-orm";
import { goalCycleOutcomes, goalCycleObjectives, goalCycleDecisions, tenantStandingAuthorizations } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { AutonomyEvidence, ClaireAutonomyLevel } from "./earnedAutonomyReadiness";

/** Real outcome counts can support readiness. They cannot certify execution safety. */
export async function loadClaireAutonomyEvidence(input: {
  tenantId: string; canonicalOperatorId: string; operatorUserId: string; exactAction: string;
  standingAuthorizationId?: string | null; requestedLevel: ClaireAutonomyLevel;
}): Promise<AutonomyEvidence> {
  const evidence: AutonomyEvidence = {
    tenantId: input.tenantId, operatorUserId: input.operatorUserId,
    relevantMissionsObserved: null, relevantMissionsCompleted: null, verifiedPlanningCycles: null,
    executionPathCertified: false, sourceCoverageFresh: false, correctionAndRevocationTested: false,
    criticalOpenDefects: null, consent: { allowedLevel: 0, revoked: false, evidenceRef: null },
  };
  const db = await getDb();
  if (!db) return evidence;
  const [outcomes, objectives, decisions] = await Promise.all([
    db.select().from(goalCycleOutcomes).where(and(eq(goalCycleOutcomes.tenantId, input.tenantId),
      eq(goalCycleOutcomes.canonicalOperatorId, input.canonicalOperatorId), eq(goalCycleOutcomes.operatorUserId, input.operatorUserId),
      eq(goalCycleOutcomes.epistemicStatus, "verified"), inArray(goalCycleOutcomes.evidenceClass, ["authoritative_external", "system_record"]))).limit(500),
    db.select().from(goalCycleObjectives).where(and(eq(goalCycleObjectives.tenantId, input.tenantId),
      eq(goalCycleObjectives.canonicalOperatorId, input.canonicalOperatorId), eq(goalCycleObjectives.operatorUserId, input.operatorUserId))).limit(500),
    db.select().from(goalCycleDecisions).where(and(eq(goalCycleDecisions.tenantId, input.tenantId),
      eq(goalCycleDecisions.canonicalOperatorId, input.canonicalOperatorId), eq(goalCycleDecisions.operatorUserId, input.operatorUserId))).limit(500),
  ]);
  // Bounded overflow is unavailable rather than an inaccurately precise count.
  if (outcomes.length < 500 && objectives.length < 500 && decisions.length < 500) {
    const relevant = new Set(objectives.filter(o => o.executionType === input.exactAction).map(o => o.id));
    const completed = new Set(outcomes.filter(o => relevant.has(o.objectiveId) && o.impactClass === "action_verification").map(o => o.objectiveId));
    evidence.relevantMissionsObserved = relevant.size;
    evidence.relevantMissionsCompleted = completed.size;
    // A persisted decision does not prove an accepted or executed planning cycle.
    evidence.verifiedPlanningCycles = new Set(outcomes.filter(o => completed.has(o.objectiveId)).map(o => o.cycleId)).size;
  }
  if (input.standingAuthorizationId) {
    const [authorization] = await db.select().from(tenantStandingAuthorizations).where(and(
      eq(tenantStandingAuthorizations.id, input.standingAuthorizationId), eq(tenantStandingAuthorizations.tenantId, input.tenantId),
      eq(tenantStandingAuthorizations.canonicalOperatorId, input.canonicalOperatorId), eq(tenantStandingAuthorizations.operatorUserId, input.operatorUserId),
      eq(tenantStandingAuthorizations.exactAction, input.exactAction))).limit(1);
    if (authorization) evidence.consent = { allowedLevel: 0, revoked: authorization.revokedAt !== null, evidenceRef: authorization.id };
    // Existing exact-action consent is honored by actionPolicy, but does not
    // authorize a broader autonomy level. No durable level grant/certification
    // has been admitted yet; those fields remain explicitly unavailable.
  }
  return evidence;
}
