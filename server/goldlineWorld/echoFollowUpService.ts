/**
 * Slice 6: Echo removes the retrieval step for a proven, already-supported
 * follow-up workflow. Every claim in the brief is a verbatim field from the
 * existing authoritative `commercial_follow_ups` record — never an LLM
 * paraphrase, never an invented promise, meeting, or discount. The optional
 * "constrained editable draft" tier from the design contract (section 6) is
 * NOT implemented here: it would need an LLM call and is deferred until this
 * deterministic brief is wired live and Adam wants that next layer.
 */
import { and, asc, eq } from "drizzle-orm";
import { commercialFollowUps } from "../../drizzle/schema";
import { getDb } from "../db";

export type FollowUpEvidence = {
  id: string;
  pipelineId: number;
  status: "open" | "completed" | "cancelled";
  dueAt: Date;
  note: string;
  assignedTo: string | null;
};

export type EchoFollowUpBrief =
  | { available: false; reason: "no_eligible_follow_up" }
  | {
      available: true;
      followUpId: string;
      pipelineId: number;
      dueAt: string;
      note: string;
      assignedTo: string | null;
      missingInfo: string[];
      provenance: "commercial_follow_up_record";
    };

/**
 * Pure — takes evidence the caller already fetched, never queries anything
 * itself. This is what makes it trivially testable and unable to silently
 * drift onto a different, unverified source of truth.
 */
export function buildEchoFollowUpBrief(
  evidence: FollowUpEvidence | null
): EchoFollowUpBrief {
  if (!evidence || evidence.status !== "open") {
    return { available: false, reason: "no_eligible_follow_up" };
  }
  const missingInfo: string[] = [];
  if (!evidence.assignedTo) missingInfo.push("no assigned contact recorded");
  if (!evidence.note.trim()) missingInfo.push("no recorded note or promise");
  return {
    available: true,
    followUpId: evidence.id,
    pipelineId: evidence.pipelineId,
    dueAt: evidence.dueAt.toISOString(),
    note: evidence.note,
    assignedTo: evidence.assignedTo,
    missingInfo,
    provenance: "commercial_follow_up_record",
  };
}

/**
 * Fetches the single nearest-due open follow-up assigned to this operator,
 * scoped by tenant — same assignment/status/ordering shape as
 * driverGameWorldService.listDriverGameWorld's follow-up join, without the
 * mission/account joins Echo doesn't need. Never invoked in this session
 * against a real database (Adam's "code + tests only, no live reads").
 */
export async function getNextEligibleFollowUp(input: {
  tenantId: string;
  operatorId: string;
}): Promise<FollowUpEvidence | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(commercialFollowUps)
    .where(
      and(
        eq(commercialFollowUps.tenantId, input.tenantId),
        eq(commercialFollowUps.assignedTo, input.operatorId),
        eq(commercialFollowUps.status, "open")
      )
    )
    .orderBy(asc(commercialFollowUps.dueAt))
    .limit(1);
  return row ?? null;
}
