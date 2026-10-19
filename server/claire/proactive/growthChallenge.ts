import type { DayDirectorProposal } from "../../../shared/dayDirector";
import {
  acceptProposalWithReceipt,
  readDayDirectorCanonicalCommitment,
} from "../../planning/dayDirector/dayDirectorService";
import { operatorInstructionAdmission } from "../../planning/dayDirector/dayLineAdmission";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { loadSalesInsight, type SalesInsightArtifact } from "./salesInsights";

export const SALES_INSIGHT_CHALLENGE_PREFIX = "sales-insight-challenge:";

export function salesInsightChallengeProposal(
  artifact: SalesInsightArtifact,
  businessDate: string
): DayDirectorProposal | null {
  const challenge = artifact.recommendedChallenge;
  if (!challenge || challenge.sourceObservationReference !== artifact.observationReference ||
      challenge.status !== "proposal_only" || challenge.requiresOperatorApproval !== true) return null;
  return {
    promptKey: `${SALES_INSIGHT_CHALLENGE_PREFIX}${artifact.observationReference}`,
    title: challenge.title,
    kind: "growth",
    quantity: null,
    sourceText: `${challenge.why} Evidence: ${artifact.observationReference}. Remote work in Admin: ${challenge.completionCondition}`,
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    detailState: "COMPLETE",
    missingDetails: [],
    detailNote: challenge.completionCondition,
    targetBusinessDate: businessDate,
    executionType: "challenge",
  };
}

export type AcceptSalesInsightChallengeResult =
  | { status: "accepted"; commitmentId: string; created: boolean; speech: string }
  | { status: "evidence_changed"; speech: string };

type GrowthChallengeDeps = {
  loadInsight: typeof loadSalesInsight;
  accept: typeof acceptProposalWithReceipt;
  readCommitment: typeof readDayDirectorCanonicalCommitment;
};

/** Called by the explicit pending-proposal confirmation path, never by discovery. */
export async function acceptSalesInsightChallenge(input: {
  tenantId: string;
  actorId: string;
  /** The authenticated operator who said yes. Required for Day Line admission. */
  operatorUserId: string;
  actorIds?: readonly string[];
  businessDate: string;
  artifact: SalesInsightArtifact;
  operatorUtterance: string;
  now?: Date;
  timeZone?: string;
}, deps: GrowthChallengeDeps = {
  loadInsight: loadSalesInsight,
  accept: acceptProposalWithReceipt,
  readCommitment: readDayDirectorCanonicalCommitment,
}): Promise<AcceptSalesInsightChallengeResult> {
  if (!input.tenantId.trim() || !input.actorId.trim() || !input.operatorUtterance.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
    throw new Error("Growth challenge acceptance requires tenant, actor, date and operator confirmation");
  }
  const current = await deps.loadInsight(input.tenantId, input.now ?? new Date(),
    input.timeZone ?? getDashboardTimeZone());
  const proposal = current && current.observationReference === input.artifact.observationReference
    ? salesInsightChallengeProposal(current, input.businessDate) : null;
  if (!proposal) return {
    status: "evidence_changed",
    speech: "The sales evidence has changed or is unavailable. I need to recheck the decline before adding that challenge.",
  };
  const result = await deps.accept({
    tenantId: input.tenantId, actorId: input.actorId, actorIds: input.actorIds,
    businessDate: input.businessDate, proposal,
    admission: operatorInstructionAdmission({
      operatorUserId: input.operatorUserId ?? "",
      surface: "claire_turn",
      sourceRef: proposal.promptKey,
    }),
  });
  if (!result.stored?.id) throw new Error("Growth challenge did not persist");
  const row = await deps.readCommitment({
    tenantId: input.tenantId, actorId: input.actorId, actorIds: input.actorIds,
    businessDate: input.businessDate, commitmentId: result.stored.id,
  });
  const actors = new Set([input.actorId, ...(input.actorIds ?? [])]);
  const metadata = row?.metadataJson as Record<string, unknown> | null;
  if (!row || row.tenantId !== input.tenantId || !actors.has(row.actorId) ||
      row.businessDate !== input.businessDate || row.title !== proposal.title ||
      row.idempotencyKey !== proposal.promptKey || row.kind !== "growth" ||
      metadata?.executionType !== "challenge" || row.sourceText !== proposal.sourceText ||
      !["open", "completed"].includes(row.status)) {
    throw new Error("Growth challenge owning-domain readback did not match acceptance");
  }
  return {
    status: "accepted", commitmentId: row.id, created: result.created,
    speech: row.status === "completed"
      ? "That growth diagnosis is already recorded as completed. It does not prove revenue recovered."
      : `Added ${row.title} to the Day Line as a Challenge. We'll review the customer and sales evidence before choosing a tactic.`,
  };
}
