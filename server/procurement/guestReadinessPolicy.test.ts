import { describe, expect, it, vi } from "vitest";
import type { AuthorityGrantPolicyView } from "./authorityPolicy";
import { evaluateGuestReadinessPlan, type ProposedServiceItem } from "./guestReadinessPolicy";
import { GuestReadinessPlanStore } from "./guestReadinessStore";

const now = new Date("2026-06-19T12:00:00.000Z");
const authority: AuthorityGrantPolicyView = {
  authorityType: "guest_readiness", status: "active", budgetCapCents: 30_000,
  deadlineAt: new Date("2026-06-22T12:00:00.000Z"), expiresAt: new Date("2026-06-22T12:00:00.000Z"),
  revokedAt: null, allowedRiskCategories: ["low", "medium"], disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry", "resident_present", "building_or_operator_approved"] },
};
const item = (patch: Partial<ProposedServiceItem> = {}): ProposedServiceItem => ({
  id: "item-1", category: "flowers", descriptionText: "Fresh flowers", estimatedCostCents: 5_000,
  scheduledAt: new Date("2026-06-20T12:00:00.000Z"), accessPattern: "no_entry", sensitivityTags: [], ...patch,
});
const evaluate = (items: ProposedServiceItem[]) => evaluateGuestReadinessPlan({
  authority, constraints: { prohibitedSensitivityTags: ["dog_dander"] }, items, now,
});

describe("Guest Readiness planning policy", () => {
  it("produces a feasible truth state without claiming booking", () => {
    const result = evaluate([item()]);
    expect(result).toMatchObject({ truthState: "feasible", planStatus: "ready", estimatedTotalCents: 5_000 });
    expect(result.items[0]?.itemState).toBe("sourcing_required");
    expect(JSON.stringify(result)).not.toContain("booked");
  });
  it("uses cumulative deterministic budget math", () => {
    const result = evaluate([item({ id: "a", estimatedCostCents: 20_000 }), item({ id: "b", estimatedCostCents: 11_000 })]);
    expect(result.estimatedTotalCents).toBe(31_000);
    expect(result.truthState).toBe("infeasible");
    expect(result.items[1]?.reasons).toContain("budget_cap_exceeded");
  });
  it("marks deadline violations infeasible", () => {
    const result = evaluate([item({ scheduledAt: new Date("2026-06-23") })]);
    expect(result.truthState).toBe("infeasible");
    expect(result.items[0]?.reasons).toContain("deadline_exceeded");
  });
  it("marks access violations infeasible", () => {
    const result = evaluate([item({ accessPattern: "unattended_entry" })]);
    expect(result.truthState).toBe("infeasible");
    expect(result.items[0]?.reasons).toContain("access_pattern_denied");
  });
  it("enforces sensitivity conflicts", () => {
    const result = evaluate([item({ sensitivityTags: ["dog_dander"] })]);
    expect(result.truthState).toBe("infeasible");
    expect(result.items[0]?.reasons).toContain("sensitivity_constraint_conflict");
  });
  it("requires resident approval for medium risk", () => {
    const result = evaluate([item({ category: "dog_grooming" })]);
    expect(result.truthState).toBe("awaiting_resident_approval");
    expect(result.items[0]?.itemState).toBe("needs_resident_approval");
  });
  it("requires operator review for gated building access", () => {
    const result = evaluate([item({ accessPattern: "building_or_operator_approved" })]);
    expect(result.truthState).toBe("awaiting_operator_review");
    expect(result.items[0]?.itemState).toBe("needs_operator_review");
  });
  it("marks high-risk and unknown categories unsupported", () => {
    expect(evaluate([item({ category: "childcare" })]).truthState).toBe("unsupported");
    expect(evaluate([item({ category: "llm_invented" })]).truthState).toBe("unsupported");
  });
  it("fails closed when there are no service items", () => expect(evaluate([]).truthState).toBe("unsupported"));
  it("persists a plan and its children transactionally without side effects", async () => {
    const connection = { beginTransaction: vi.fn(), execute: vi.fn().mockResolvedValue([{}]), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const store = new GuestReadinessPlanStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const decision = evaluate([item()]);
    await store.createEvaluatedPlan({ id: "plan-1", authorityGrantId: "grant-1", tenantId: "default",
      bldgUserId: 1, buildingSlug: "opusla", objectiveText: "Ready for guest", budgetCapCents: 30_000,
      deadlineAt: authority.deadlineAt, accessConstraints: authority.accessConstraints,
      sensitivityConstraints: { prohibitedSensitivityTags: ["dog_dander"] }, decision });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.execute.mock.calls.flat().join(" ")).not.toMatch(/stripe|payment|vendor|outreach/i);
  });
});
