import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ErrandPurchasePathDecision, ErrandPurchasePathStatus } from "./errandPurchasePathPolicy";
import { evaluateRealWorldExecutionGate, realWorldExecutionGateKey,
  type RealWorldExecutionGateView } from "./realWorldExecutionGatePolicy";

const now = new Date("2026-06-19T12:00:00Z");
const workflowKey = "guest_readiness:item-1";
const subjectType = "guest_readiness_plan_item" as const;
const subjectId = "item-1";
const requiredGateKey = realWorldExecutionGateKey({ workflowKey, subjectType, subjectId });

const readiness = (status: ErrandPurchasePathStatus = "ready_for_operator_execution_review",
  reasons: string[] = []): ErrandPurchasePathDecision => ({
  status, reviewReady: status === "ready_for_operator_execution_review", executionReady: false,
  dispatchReady: false, paymentReady: false, reasons,
});
const gate = (overrides: Partial<RealWorldExecutionGateView> = {}): RealWorldExecutionGateView => ({
  gateKey: requiredGateKey, workflowKey, subjectType, subjectId, status: "approved",
  deadlineAt: new Date("2026-06-20T00:00:00Z"), decidedAt: new Date("2026-06-19T11:00:00Z"), ...overrides,
});
const base = (overrides: Record<string, unknown> = {}) => ({
  readiness: readiness(), workflowKey, subjectType, subjectId, authorityCurrent: true,
  vendorAgreementRequired: true, vendorAgreementCurrent: true,
  providerAcceptanceRequired: true, providerAcceptanceCurrent: true,
  paymentRequired: true, paymentAuthorized: true, riskConfirmationRequired: false,
  gate: null as RealWorldExecutionGateView | null, now, ...overrides,
});

describe("real-world execution gate policy", () => {
  it("requires a deterministic gate for a review-ready path", () => {
    expect(evaluateRealWorldExecutionGate(base())).toMatchObject({
      status: "gate_required", gateRequired: true, requiredGateKey, operatorExecutionApproved: false,
    });
  });

  it("requires a risk confirmation gate for a high-risk confirmation path", () => {
    const result = evaluateRealWorldExecutionGate(base({
      readiness: readiness("requires_operator_confirmation", ["high_risk_operator_confirmation_required"]),
      riskConfirmationRequired: true,
    }));
    expect(result).toMatchObject({ status: "gate_required", requiredGateKey });
    expect(result.reasons).toContain("risk_confirmation_gate_required");
  });

  it.each(["unsupported", "infeasible"] as const)("does not let a gate override %s readiness", status => {
    expect(evaluateRealWorldExecutionGate(base({ readiness: readiness(status), gate: gate() }))).toMatchObject({
      status: "blocked", operatorExecutionApproved: false,
    });
  });

  it.each([
    ["blocked_missing_authority", {}],
    ["blocked_missing_vendor_agreement", {}],
    ["blocked_missing_provider_acceptance", {}],
    ["blocked_payment_not_authorized", {}],
    ["ready_for_operator_execution_review", { authorityCurrent: false }],
    ["ready_for_operator_execution_review", { vendorAgreementCurrent: false }],
    ["ready_for_operator_execution_review", { providerAcceptanceCurrent: false }],
    ["ready_for_operator_execution_review", { paymentAuthorized: false }],
  ] as const)("keeps %s or stale prerequisite evidence blocked", (status, overrides) => {
    expect(evaluateRealWorldExecutionGate(base({ readiness: readiness(status), gate: gate(), ...overrides })))
      .toMatchObject({ status: "blocked", operatorExecutionApproved: false });
  });

  it.each(["expired", "revoked"])("blocks an %s vendor agreement even with an approved gate", () => {
    const result = evaluateRealWorldExecutionGate(base({ gate: gate(), vendorAgreementCurrent: false }));
    expect(result).toMatchObject({ status: "blocked", operatorExecutionApproved: false });
    expect(result.reasons).toContain("vendor_agreement_not_current");
  });

  it("reports pending and denied gates without approval", () => {
    expect(evaluateRealWorldExecutionGate(base({ gate: gate({ status: "pending", decidedAt: null }) }))).toMatchObject({
      status: "gate_pending", operatorExecutionApproved: false,
    });
    expect(evaluateRealWorldExecutionGate(base({ gate: gate({ status: "rejected" }) }))).toMatchObject({
      status: "gate_denied", operatorExecutionApproved: false,
    });
  });

  it("blocks wrong-key, subject-mismatched, and stale gates", () => {
    expect(evaluateRealWorldExecutionGate(base({ gate: gate({ gateKey: "wrong" }) })).reasons)
      .toContain("operator_gate_key_mismatch");
    expect(evaluateRealWorldExecutionGate(base({ gate: gate({ subjectId: "other" }) })).reasons)
      .toContain("operator_gate_subject_mismatch");
    expect(evaluateRealWorldExecutionGate(base({ gate: gate({ deadlineAt: now }) })).reasons)
      .toContain("operator_gate_stale");
  });

  it("approved gate allows only the next controlled operator step", () => {
    expect(evaluateRealWorldExecutionGate(base({ gate: gate() }))).toEqual({
      status: "gate_approved", gateRequired: true, requiredGateKey,
      operatorExecutionApproved: true, executionReady: false, dispatchReady: false,
      paymentReady: false, booked: false, completed: false,
      reasons: ["operator_execution_approved_for_next_controlled_step"],
    });
  });

  it("does not let operator approval replace resident approval", () => {
    const result = evaluateRealWorldExecutionGate(base({ gate: gate(),
      readiness: readiness("requires_operator_confirmation", ["resident_approval_required"]) }));
    expect(result).toMatchObject({ status: "blocked", operatorExecutionApproved: false });
  });

  it("has no I/O, contact, send, dispatch, or payment side effects", async () => {
    const source = await readFile(new URL("./realWorldExecutionGatePolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/twilio|sendgrid|stripe|nodemailer|Store\b|LLM/i);
    expect(source).not.toMatch(/dispatchReady:\s*true|paymentReady:\s*true|executionReady:\s*true/i);
  });
});
