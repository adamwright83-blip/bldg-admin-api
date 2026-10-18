import { describe, expect, it, vi } from "vitest";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";
import {
  assertDayDirectorWriteAdmission,
  type DayDirectorAdmission,
  type DayDirectorAdmissionDeps,
} from "./dayDirectorAdmission";

// Stage 1 authority rule: a Day Line write names the operator's authority, or it is refused.

const approval = {
  proposalId: "proposal-1",
  revision: "rev-1",
  itemId: "item-1",
  responseId: "response_1",
  canonicalOperatorId: "tenant:t1:operator:op-1",
  approvedByUserId: "op-1",
};

function proposal(overrides: Partial<DayDirectorProposal> = {}): DayDirectorProposal {
  return {
    promptKey: "briefing:abc",
    title: "Call Mei",
    kind: "growth",
    quantity: null,
    sourceText: "Call Mei about the order",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    ...overrides,
  };
}

function deps(overrides: Partial<DayDirectorAdmissionDeps> = {}): DayDirectorAdmissionDeps {
  return {
    loadStrategicResponse: vi.fn(async () => ({
      action: "approve",
      revision: "rev-1",
      itemIds: ["item-1"],
      operatorUserId: "op-1",
    })),
    loadActiveRecurrenceRule: vi.fn(async () => ({ id: "rule-1" })),
    ...overrides,
  };
}

const instruction: DayDirectorAdmission = {
  kind: "operator_instruction",
  channel: "authenticated_app",
  operatorActorId: "42",
  instructionRef: "day_director.accept:op-1:briefing:abc",
};

function check(
  admission: unknown,
  extra: Partial<Parameters<typeof assertDayDirectorWriteAdmission>[0]> = {},
  injected = deps()
) {
  return assertDayDirectorWriteAdmission(
    {
      admission: admission as DayDirectorAdmission,
      tenantId: "t1",
      actorIds: ["42"],
      write: "accept",
      proposal: proposal(),
      businessDate: "2026-10-19",
      ...extra,
    },
    injected
  );
}

describe("Day Director write admission", () => {
  it("refuses a write with no admission", async () => {
    await expect(check(undefined)).rejects.toMatchObject({ reason: "admission_missing" });
    await expect(check(null)).rejects.toMatchObject({ reason: "admission_missing" });
  });

  it("refuses an admission kind it does not recognise", async () => {
    await expect(check({ kind: "board_sweep" })).rejects.toMatchObject({ reason: "admission_unknown" });
  });

  it("does not treat a goal-cycle policy decision as an admission", async () => {
    // INTERNAL_REVERSIBLE allows preparation automatically; it never commits Day Line work.
    const automatic = {
      allowed: true,
      authority: "automatic",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    };
    await expect(check(automatic)).rejects.toMatchObject({ reason: "admission_unknown" });
    await expect(check({ ...automatic, kind: "automatic" })).rejects.toMatchObject({
      reason: "admission_unknown",
    });
  });

  it("admits an operator instruction for the operator's own Day Line", async () => {
    await expect(check(instruction)).resolves.toEqual({
      kind: "operator_instruction",
      channel: "authenticated_app",
      instructionRef: "day_director.accept:op-1:briefing:abc",
    });
  });

  it("refuses an instruction that names another operator, an unknown actor, or no reference", async () => {
    await expect(check({ ...instruction, operatorActorId: "7" })).rejects.toMatchObject({
      reason: "operator_not_owner",
    });
    await expect(
      check({ ...instruction, operatorActorId: "unknown" }, { actorIds: ["unknown"] })
    ).rejects.toMatchObject({ reason: "operator_not_owner" });
    await expect(check({ ...instruction, instructionRef: "  " })).rejects.toMatchObject({
      reason: "instruction_reference_missing",
    });
    await expect(check({ ...instruction, channel: "background_worker" })).rejects.toMatchObject({
      reason: "channel_unknown",
    });
  });

  it("never lets an operator instruction carry strategic approval lineage", async () => {
    await expect(
      check(instruction, { proposal: proposal({ strategicApproval: approval }) })
    ).rejects.toMatchObject({ reason: "strategic_approval_mismatch" });
  });

  it("admits a strategic approval only when it is the recorded approval of that exact item", async () => {
    const injected = deps();
    await expect(
      check(
        { kind: "strategic_approval", approval },
        { proposal: proposal({ strategicApproval: approval }) },
        injected
      )
    ).resolves.toEqual({ kind: "strategic_approval", responseId: "response_1" });
    expect(injected.loadStrategicResponse).toHaveBeenCalledWith({
      tenantId: "t1",
      responseId: "response_1",
      proposalId: "proposal-1",
      canonicalOperatorId: "tenant:t1:operator:op-1",
    });
  });

  it("refuses a strategic approval that is not recorded, not an approval, or not this item", async () => {
    const withLineage = { proposal: proposal({ strategicApproval: approval }) };
    const admission = { kind: "strategic_approval", approval };
    await expect(
      check(admission, withLineage, deps({ loadStrategicResponse: async () => null }))
    ).rejects.toMatchObject({ reason: "strategic_approval_not_recorded" });
    for (const recorded of [
      { action: "reject", revision: "rev-1", itemIds: ["item-1"], operatorUserId: "op-1" },
      { action: "approve", revision: "rev-0", itemIds: ["item-1"], operatorUserId: "op-1" },
      { action: "approve", revision: "rev-1", itemIds: ["item-2"], operatorUserId: "op-1" },
      { action: "approve", revision: "rev-1", itemIds: ["item-1"], operatorUserId: "op-9" },
    ]) {
      await expect(
        check(admission, withLineage, deps({ loadStrategicResponse: async () => recorded }))
      ).rejects.toMatchObject({ reason: "strategic_approval_not_recorded" });
    }
  });

  it("refuses a strategic approval that differs from the lineage the commitment would store", async () => {
    await expect(
      check(
        { kind: "strategic_approval", approval: { ...approval, itemId: "item-2" } },
        { proposal: proposal({ strategicApproval: approval }) }
      )
    ).rejects.toMatchObject({ reason: "strategic_approval_mismatch" });
    await expect(
      check({ kind: "strategic_approval", approval }, { proposal: proposal() })
    ).rejects.toMatchObject({ reason: "strategic_approval_mismatch" });
    await expect(
      check(
        { kind: "strategic_approval", approval: { ...approval, responseId: "" } },
        { proposal: proposal({ strategicApproval: { ...approval, responseId: "" } }) }
      )
    ).rejects.toMatchObject({ reason: "strategic_approval_mismatch" });
  });

  it("does not let a strategic approval complete, edit, move or re-designate work", async () => {
    for (const write of ["complete", "update", "move", "designate_primary"] as const) {
      await expect(
        check({ kind: "strategic_approval", approval }, { write, proposal: undefined })
      ).rejects.toMatchObject({ reason: "admission_not_valid_for_write" });
    }
  });

  it("admits a recurrence occurrence only through an active rule the operator owns", async () => {
    const command = { ...emptyCommandMetadata(), recurrenceRuleId: "rule-1" };
    const occurrence = proposal({ promptKey: "recurrence:rule-1:2026-10-19", command });
    const admission = { kind: "operator_recurrence_rule", ruleId: "rule-1", operatorActorId: "42" };
    const injected = deps();
    await expect(check(admission, { proposal: occurrence }, injected)).resolves.toEqual({
      kind: "operator_recurrence_rule",
      ruleId: "rule-1",
    });
    expect(injected.loadActiveRecurrenceRule).toHaveBeenCalledWith({
      tenantId: "t1",
      ruleId: "rule-1",
      actorId: "42",
    });
    await expect(
      check(admission, { proposal: occurrence }, deps({ loadActiveRecurrenceRule: async () => null }))
    ).rejects.toMatchObject({ reason: "recurrence_rule_inactive" });
    await expect(
      check(admission, { proposal: proposal({ promptKey: "recurrence:rule-1:2026-10-20", command }) })
    ).rejects.toMatchObject({ reason: "recurrence_rule_mismatch" });
    await expect(check(admission, { proposal: proposal() })).rejects.toMatchObject({
      reason: "recurrence_rule_mismatch",
    });
    await expect(
      check({ ...admission, operatorActorId: "7" }, { proposal: occurrence })
    ).rejects.toMatchObject({ reason: "operator_not_owner" });
  });
});
