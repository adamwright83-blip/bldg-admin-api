import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ErrandPurchasePathDecision, ErrandPurchasePathStatus } from "./errandPurchasePathPolicy";
import type { RealWorldExecutionGateDecision, RealWorldExecutionGateStatus } from "./realWorldExecutionGatePolicy";
import { evaluateDispatchReadiness, evaluateManualDispatchRecord, evaluateProofStatus } from "./dispatchProofPolicy";

const path = (status: ErrandPurchasePathStatus = "ready_for_operator_execution_review"): ErrandPurchasePathDecision => ({
  status, reviewReady: status === "ready_for_operator_execution_review", executionReady: false,
  dispatchReady: false, paymentReady: false, reasons: [],
});
const gate = (status: RealWorldExecutionGateStatus = "gate_approved"): RealWorldExecutionGateDecision => ({
  status, gateRequired: true, requiredGateKey: "real_world_execution_approval:guest_readiness_plan_item:item-1",
  operatorExecutionApproved: status === "gate_approved", executionReady: false, dispatchReady: false,
  paymentReady: false, booked: false, completed: false, reasons: [],
});
const readyInput = () => ({ pathType: "vendor_service" as const, purchasePath: path(), executionGate: gate(),
  mandateState: "dispatch_pending" as const, vendorAgreementRequired: true, vendorAgreementCurrent: true,
  providerAcceptanceRequired: true, providerAcceptanceCurrent: true });

describe("dispatch proof policy", () => {
  it("allows only manual-dispatch readiness when every controlled prerequisite is current", () => {
    expect(evaluateDispatchReadiness(readyInput())).toEqual({
      allowed: true, nextDispatchStatus: "ready_for_manual_dispatch", readyForManualDispatch: true,
      manualDispatchRecorded: false, completionAllowed: false, dispatchIntegrationInvoked: false,
      messageSent: false, paymentAuthorized: false, paymentCaptured: false, reasons: [],
    });
  });

  it.each([
    { executionGate: gate("gate_pending") },
    { vendorAgreementCurrent: false },
    { providerAcceptanceCurrent: false },
    { purchasePath: path("blocked_missing_authority") },
    { pathType: "unsupported" as const },
    { mandateState: "blocked" as const },
    { mandateState: "cancelled" as const },
  ])("fails closed for missing, blocked, unsupported, or cancelled prerequisites", override => {
    const result = evaluateDispatchReadiness({ ...readyInput(), ...override });
    expect(result.allowed).toBe(false);
    expect(result.nextDispatchStatus).toBe("dispatch_blocked");
  });

  it("records manual dispatch state without claiming completion or invoking an integration", () => {
    expect(evaluateManualDispatchRecord("ready_for_manual_dispatch")).toMatchObject({
      allowed: true, nextDispatchStatus: "manually_dispatched", manualDispatchRecorded: true,
      completionAllowed: false, dispatchIntegrationInvoked: false, paymentCaptured: false,
    });
  });

  it("keeps submitted proof pending and incomplete", () => {
    expect(evaluateProofStatus({ dispatchStatus: "manually_dispatched", proofStatus: "submitted" })).toMatchObject({
      allowed: true, nextDispatchStatus: "proof_pending", completionAllowed: false, paymentCaptured: false,
    });
  });

  it("allows completion review only for verified proof without capturing payment", () => {
    expect(evaluateProofStatus({ dispatchStatus: "proof_pending", proofStatus: "verified" })).toMatchObject({
      allowed: true, nextDispatchStatus: "proof_verified", completionAllowed: true,
      dispatchIntegrationInvoked: false, paymentCaptured: false,
    });
    expect(evaluateProofStatus({ dispatchStatus: "proof_pending", proofStatus: "needs_review" }).completionAllowed)
      .toBe(false);
  });

  it("defines additive schema without seeds, send IDs, payment fields, or legacy vendor references", async () => {
    const sql = await readFile(new URL("../../procurement/migrations/0011_dispatch_proof_foundation.sql", import.meta.url), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `dispatch_requests`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `dispatch_events`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `proof_of_completion_records`");
    expect(sql).not.toMatch(/`sent_at`|`provider_message_id`|`delivery_status`|`capture_id`|`authorization_id`/i);
    expect(sql).not.toMatch(/REFERENCES\s+`(?:vendors|vendorProfiles|vendorServices)`/i);
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });

  it("store writes only the three new dispatch/proof tables and has no external calls", async () => {
    const source = await readFile(new URL("./dispatchProofStore.ts", import.meta.url), "utf8");
    const writes = [...source.matchAll(/(?:INSERT\s+INTO|UPDATE)\s+([a-z_]+)/gi)].map(match => match[1]);
    expect(new Set(writes)).toEqual(new Set(["dispatch_requests", "dispatch_events", "proof_of_completion_records"]));
    expect(source).not.toMatch(/vendorProfiles|vendorServices|stripe|fetch\(|axios|twilio|sendgrid|nodemailer/i);
  });

  it("pure policy has no I/O, contact, messaging, dispatch, or payment side effects", async () => {
    const source = await readFile(new URL("./dispatchProofPolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/twilio|sendgrid|stripe|nodemailer|Store\b|LLM/i);
    expect(source).not.toMatch(/dispatchIntegrationInvoked:\s*true|messageSent:\s*true|paymentCaptured:\s*true/i);
  });
});
