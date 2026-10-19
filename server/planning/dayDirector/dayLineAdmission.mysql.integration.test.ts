import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dayDirectorCommitments, strategicProposalResponses } from "../../../drizzle/schema";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { getDb } from "../../db";
import { acceptProposalWithReceipt } from "./dayDirectorService";
import {
  DayLineAdmissionRefusedError,
  operatorInstructionAdmission,
  recurrenceRuleAdmission,
  strategicApprovalAdmission,
} from "./dayLineAdmission";
import {
  cancelRecurrenceRule,
  confirmRecurrenceRule,
  projectRecurrenceForDate,
  recurrenceIdempotencyKey,
} from "../../claire/workdayRecurrenceService";

/**
 * Real-MySQL proof for Stage 1 · 1C-i: the Day Director write boundary admits
 * only the operator's exact approval or direct instruction, and a refused
 * write leaves storage untouched.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

function proposal(overrides: Partial<DayDirectorProposal> = {}): DayDirectorProposal {
  return {
    promptKey: `commitment:${randomUUID().slice(0, 12)}`,
    title: "Visit The Louise",
    kind: "growth",
    quantity: null,
    sourceText: "Visit The Louise",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    ...overrides,
  };
}

async function commitmentsFor(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(dayDirectorCommitments).where(eq(dayDirectorCommitments.tenantId, tenantId));
}

describeMysql("Day Line admission on MySQL", () => {
  const suffix = () => randomUUID().replaceAll("-", "").slice(0, 10);
  const businessDate = "2026-10-19"; // a Monday

  it("refuses un-admitted writes and stores nothing; an operator instruction is stored with its proof", async () => {
    const tenantId = `admit-1ci-${suffix()}`;
    const p = proposal();
    for (const admission of [undefined, { kind: "policy_receipt", riskClass: "INTERNAL_REVERSIBLE" }, { kind: "operator_instruction", operatorUserId: "unknown", surface: "claire_turn", sourceRef: "x" }]) {
      await expect(
        acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: p, admission } as never)
      ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
    }
    expect(await commitmentsFor(tenantId)).toEqual([]);

    const admission = operatorInstructionAdmission({ operatorUserId: "adam-open-id", surface: "day_line_ui", sourceRef: `day_director.accept:${p.promptKey}` });
    const { stored, created } = await acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: p, admission });
    expect(created).toBe(true);
    const rows = await commitmentsFor(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(stored!.id);
    expect((rows[0]!.metadataJson as Record<string, unknown>).dayLineAdmission).toEqual(admission);

    // A refused retry on the same key cannot rewrite the admitted row.
    await expect(
      acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: { ...p, title: "Rewritten by a machine" } } as never)
    ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
    const after = await commitmentsFor(tenantId);
    expect(after).toHaveLength(1);
    expect(after[0]!.title).toBe("Visit The Louise");
  });

  it("admits strategic approval only when the stored approval response matches", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tenantId = `admit-1ci-${suffix()}`;
    const lineage = {
      proposalId: `proposal-${suffix()}`,
      revision: "r".repeat(64),
      itemId: "item-1",
      responseId: `response_${suffix()}`,
      canonicalOperatorId: `tenant:${tenantId}:operator:adam-open-id`,
      approvedByUserId: "adam-open-id",
    };
    const approved = proposal({ strategicApproval: lineage });

    // No stored approval: refused, nothing stored.
    await expect(
      acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: approved, admission: strategicApprovalAdmission(lineage) })
    ).rejects.toThrow(/no stored operator approval matches this item/);
    expect(await commitmentsFor(tenantId)).toEqual([]);

    await db.insert(strategicProposalResponses).values({
      id: lineage.responseId,
      proposalId: lineage.proposalId,
      tenantId,
      canonicalOperatorId: lineage.canonicalOperatorId,
      responseJson: {
        id: lineage.responseId,
        proposalId: lineage.proposalId,
        revision: lineage.revision,
        tenantId,
        canonicalOperatorId: lineage.canonicalOperatorId,
        operatorUserId: lineage.approvedByUserId,
        action: "approve",
        itemIds: [lineage.itemId],
        source: "authenticated_app",
        note: null,
      },
    });

    // A proof for another item, or an operator claim on an approved item, is still refused.
    await expect(
      acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: approved, admission: strategicApprovalAdmission({ ...lineage, itemId: "item-2" }) })
    ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
    await expect(
      acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: approved, admission: operatorInstructionAdmission({ operatorUserId: "adam-open-id", surface: "claire_turn", sourceRef: "turn" }) })
    ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
    expect(await commitmentsFor(tenantId)).toEqual([]);

    const { created } = await acceptProposalWithReceipt({ tenantId, actorId: "1", businessDate, proposal: approved, admission: strategicApprovalAdmission(lineage) });
    expect(created).toBe(true);
    const rows = await commitmentsFor(tenantId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.metadataJson as Record<string, unknown>).strategicApproval).toEqual(lineage);
    expect((rows[0]!.metadataJson as Record<string, any>).dayLineAdmission).toMatchObject({ kind: "strategic_approval", responseId: lineage.responseId });
  });

  it("projects an active operator recurrence rule, and refuses it once cancelled", async () => {
    const tenantId = `admit-1ci-${suffix()}`;
    const rule = await confirmRecurrenceRule({
      tenantId, actorId: "1", title: "Restock the van", kind: "prep", weekday: "monday", sourceText: "restock the van every Monday",
    });
    const projected = await projectRecurrenceForDate({ tenantId, actorId: "1", businessDate });
    expect(projected.created).toBe(1);
    const rows = await commitmentsFor(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotencyKey).toBe(recurrenceIdempotencyKey(rule.id, businessDate));
    expect((rows[0]!.metadataJson as Record<string, unknown>).dayLineAdmission).toEqual({ kind: "operator_recurrence_rule", ruleId: rule.id });

    await cancelRecurrenceRule({ tenantId, actorId: "1", ruleId: rule.id });
    const nextMonday = "2026-10-26";
    const command = (rows[0]!.metadataJson as Record<string, any>).command;
    await expect(
      acceptProposalWithReceipt({
        tenantId, actorId: "1", businessDate: nextMonday,
        proposal: proposal({ promptKey: recurrenceIdempotencyKey(rule.id, nextMonday), command }),
        admission: recurrenceRuleAdmission(rule.id),
      })
    ).rejects.toThrow(/the recurrence rule is not active for this operator/);
    expect(await commitmentsFor(tenantId)).toHaveLength(1);
  });
});
