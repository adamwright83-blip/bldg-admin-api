import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dayDirectorCommitments, strategicProposalResponses } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { projectRecurrenceForDate } from "../../claire/workdayRecurrenceService";
import {
  acceptProposalWithReceipt,
  completeDayDirectorCommitment,
  moveDayDirectorCommitment,
  updateDayDirectorCommitment,
} from "./dayDirectorService";
import {
  cancelDayDirectorRecurrenceRule,
  persistDayDirectorRecurrenceRule,
} from "./workdayRecurrenceStore";
import type { DayDirectorAdmission } from "./dayDirectorAdmission";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";

/**
 * Real-MySQL proof for Stage 1 1C-i: the Day Director write boundary admits a
 * commitment only on the operator's authority, checked against what is stored.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

function fixture() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  return { tenantId: `admit-${suffix}`, actorId: `actor-${suffix}`, suffix };
}

function proposal(promptKey: string, extra: Record<string, unknown> = {}) {
  return {
    promptKey,
    title: "Text Mei about her order",
    kind: "growth" as const,
    quantity: null,
    sourceText: "Text Mei about her order",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback" as const,
    ...extra,
  };
}

async function rowsFor(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(dayDirectorCommitments).where(eq(dayDirectorCommitments.tenantId, tenantId));
}

describeMysql("Day Director write admission on MySQL", () => {
  it("an un-admitted write, or one for another operator, leaves no row", async () => {
    const { tenantId, actorId } = fixture();
    await expect(
      acceptProposalWithReceipt({
        tenantId,
        actorId,
        businessDate: "2026-10-19",
        proposal: proposal("claire-proactive:sales:6:2026-08-07"),
      } as never)
    ).rejects.toMatchObject({ reason: "admission_missing" });
    await expect(
      acceptProposalWithReceipt({
        tenantId,
        actorId,
        businessDate: "2026-10-19",
        proposal: proposal("briefing:other"),
        admission: { kind: "operator_instruction", channel: "claire_conversation", operatorActorId: "someone-else", instructionRef: "briefing:x" },
      })
    ).rejects.toMatchObject({ reason: "operator_not_owner" });
    expect(await rowsFor(tenantId)).toHaveLength(0);
  });

  it("an operator instruction writes the row and keeps its admission; later writes need their own", async () => {
    const { tenantId, actorId } = fixture();
    const admission: DayDirectorAdmission = {
      kind: "operator_instruction",
      channel: "authenticated_app",
      operatorActorId: actorId,
      instructionRef: `day_director.accept:${actorId}:briefing:abc`,
    };
    const { stored, created } = await acceptProposalWithReceipt({
      tenantId,
      actorId,
      businessDate: "2026-10-19",
      proposal: proposal("briefing:abc"),
      admission,
    });
    expect(created).toBe(true);
    expect(stored?.metadataJson).toMatchObject({
      admission: { kind: "operator_instruction", channel: "authenticated_app", instructionRef: admission.instructionRef },
    });

    const id = stored!.id;
    await expect(
      completeDayDirectorCommitment({ tenantId, actorId, commitmentId: id } as never)
    ).rejects.toMatchObject({ reason: "admission_missing" });
    await expect(
      updateDayDirectorCommitment({ tenantId, actorId, commitmentId: id, patch: { detailNote: "changed" } } as never)
    ).rejects.toMatchObject({ reason: "admission_missing" });
    await expect(
      moveDayDirectorCommitment({ tenantId, actorId, commitmentId: id, fromBusinessDate: "2026-10-19", toBusinessDate: "2026-10-20" } as never)
    ).rejects.toMatchObject({ reason: "admission_missing" });
    const [unchanged] = await rowsFor(tenantId);
    expect(unchanged).toMatchObject({ status: "open", businessDate: "2026-10-19" });
    expect((unchanged!.metadataJson as Record<string, unknown>).detailNote).toBeNull();

    await completeDayDirectorCommitment({ tenantId, actorId, commitmentId: id, admission });
    const [done] = await rowsFor(tenantId);
    expect(done).toMatchObject({ status: "completed" });
  });

  it("a strategic approval is admitted only when that approval is recorded", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const { tenantId, actorId, suffix } = fixture();
    const approval = {
      proposalId: `proposal-${suffix}`,
      revision: `rev-${suffix}`,
      itemId: `item-${suffix}`,
      responseId: `response_${suffix}`,
      canonicalOperatorId: `tenant:${tenantId}:operator:op-${suffix}`,
      approvedByUserId: `op-${suffix}`,
    };
    const approved = () =>
      acceptProposalWithReceipt({
        tenantId,
        actorId,
        businessDate: "2026-10-19",
        proposal: proposal(`strategy-approved:${suffix}`, { strategicApproval: approval, targetBusinessDate: "2026-10-19" }),
        admission: { kind: "strategic_approval", approval },
      });

    // A forged lineage with no recorded approval writes nothing.
    await expect(approved()).rejects.toMatchObject({ reason: "strategic_approval_not_recorded" });
    expect(await rowsFor(tenantId)).toHaveLength(0);

    await db.insert(strategicProposalResponses).values({
      id: approval.responseId,
      proposalId: approval.proposalId,
      tenantId,
      canonicalOperatorId: approval.canonicalOperatorId,
      responseJson: {
        id: approval.responseId,
        proposalId: approval.proposalId,
        revision: approval.revision,
        tenantId,
        canonicalOperatorId: approval.canonicalOperatorId,
        operatorUserId: approval.approvedByUserId,
        action: "approve",
        itemIds: [approval.itemId],
        source: "authenticated_app",
        note: null,
      },
    });
    const { stored } = await approved();
    expect(stored?.metadataJson).toMatchObject({
      strategicApproval: approval,
      admission: { kind: "strategic_approval", responseId: approval.responseId },
    });
  });

  it("a recurrence occurrence is admitted while its rule is active, and refused once it is cancelled", async () => {
    const { tenantId, actorId, suffix } = fixture();
    const rule = await persistDayDirectorRecurrenceRule({
      tenantId,
      actorId,
      sourceIdentity: `rule-${suffix}`,
      title: "Restock detergent",
      kind: "operations",
      weekday: "monday",
      sourceText: "Every Monday restock detergent",
    });
    const projected = await projectRecurrenceForDate({ tenantId, actorId, businessDate: "2026-10-19" });
    expect(projected.projectedIds).toHaveLength(1);
    const [occurrence] = await rowsFor(tenantId);
    expect(occurrence?.metadataJson).toMatchObject({ admission: { kind: "operator_recurrence_rule", ruleId: rule.id } });

    await cancelDayDirectorRecurrenceRule({ tenantId, actorId, ruleId: rule.id });
    await expect(
      acceptProposalWithReceipt({
        tenantId,
        actorId,
        businessDate: "2026-10-26",
        proposal: proposal(`recurrence:${rule.id}:2026-10-26`, {
          command: { ...emptyCommandMetadata(), role: "fixed", recurrenceRuleId: rule.id },
        }),
        admission: { kind: "operator_recurrence_rule", ruleId: rule.id, operatorActorId: actorId },
      })
    ).rejects.toMatchObject({ reason: "recurrence_rule_inactive" });
    const db = await getDb();
    const later = await db!
      .select({ id: dayDirectorCommitments.id })
      .from(dayDirectorCommitments)
      .where(and(eq(dayDirectorCommitments.tenantId, tenantId), eq(dayDirectorCommitments.businessDate, "2026-10-26")));
    expect(later).toHaveLength(0);
  });
});
