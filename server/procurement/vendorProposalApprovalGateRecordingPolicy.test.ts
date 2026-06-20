import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateVendorProposalApprovalGateRecording } from "./vendorProposalApprovalGateRecordingPolicy";
import type { ProposalApprovalGateDecision } from "./vendorProposalApprovalGatePolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

const mockIdentifiers = {
  workflowId: "workflow-123",
  proposalId: "proposal-456",
  candidateId: "candidate-789",
};

const mockProposalSnapshot = {
  status: "proposal_ready_for_review",
  expiresAt: new Date("2026-06-21T12:00:00.000Z"),
  quotedAmountCents: 12000,
};

const makeMockGateDecision = (status: ProposalApprovalGateDecision["status"]): ProposalApprovalGateDecision => ({
  status,
  allowed: status === "proposal_approved_for_next_step_only",
  reasons: ["test_reason"],
  riskFlags: ["test_flag"],
  booked: false,
  accepted: false,
  dispatched: false,
  paid: false,
  captured: false,
  completed: false,
  selectedForExecution: false,
  providerAccepted: false,
  bookingVerified: false,
  paymentAuthorized: false,
  paymentCaptured: false,
  invoiceCreated: false,
  payableCreated: false,
});

describe("evaluateVendorProposalApprovalGateRecording -- logic cases", () => {
  it("operator review gate result produces record_operator_review_required command", () => {
    const gateDecision = makeMockGateDecision("proposal_requires_operator_review");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_operator_review_required");
    expect(cmd.allowed).toBe(true);
    expect(cmd.payload?.approvalType).toBe("proposal_requires_operator_review");
  });

  it("resident approval gate result produces record_resident_approval_required command", () => {
    const gateDecision = makeMockGateDecision("proposal_requires_resident_approval");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_resident_approval_required");
    expect(cmd.payload?.reasonCodes).toContain("test_reason");
  });

  it("budget approval gate result produces record_budget_approval_required command", () => {
    const gateDecision = makeMockGateDecision("proposal_requires_budget_approval");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_budget_approval_required");
  });

  it("payment authorization requirement produces record_payment_authorization_required but does not authorize payment", () => {
    const gateDecision = makeMockGateDecision("proposal_requires_payment_authorization");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_payment_authorization_required");
    expect(cmd.paymentAuthorized).toBe(false);
  });

  it("legal review requirement produces record_legal_review_required", () => {
    const gateDecision = makeMockGateDecision("proposal_requires_legal_review");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_legal_review_required");
  });

  it("clean next-step-only approval produces record_next_step_only_approval but not execution", () => {
    const gateDecision = makeMockGateDecision("proposal_approved_for_next_step_only");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_next_step_only_approval");
    expect(cmd.allowed).toBe(true);
    expect(cmd.booked).toBe(false);
    expect(cmd.selectedForExecution).toBe(false);
  });

  it("rejected gate produces record_rejection", () => {
    const gateDecision = makeMockGateDecision("proposal_rejected");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.command).toBe("record_rejection");
    expect(cmd.allowed).toBe(true); // allowed to record the rejection command itself
  });

  it("expired/not allowed/missing identifiers fail closed", () => {
    const gateDecision = makeMockGateDecision("proposal_approved_for_next_step_only");

    // 1. Expired
    const expiredSnapshot = {
      ...mockProposalSnapshot,
      expiresAt: new Date("2026-06-19T12:00:00.000Z"),
    };
    const cmd1 = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: expiredSnapshot,
      now: NOW,
    });
    expect(cmd1.command).toBe("recording_not_allowed");
    expect(cmd1.allowed).toBe(false);

    // 2. Not ready status
    const notReadySnapshot = {
      ...mockProposalSnapshot,
      status: "proposal_requirements_missing",
    };
    const cmd2 = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: notReadySnapshot,
      now: NOW,
    });
    expect(cmd2.command).toBe("recording_not_allowed");

    // 3. Missing identifiers
    const cmd3 = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: { workflowId: "", proposalId: "", candidateId: "" },
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });
    expect(cmd3.command).toBe("recording_not_allowed");
  });

  it("deterministic command key and gate key", () => {
    const gateDecision = makeMockGateDecision("proposal_approved_for_next_step_only");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.commandKey).toBe("proposal_recording:workflow-123:proposal-456:idemp-abc");
    expect(cmd.gateKey).toBe("proposal_gate:workflow-123:candidate-789");
  });

  it("output hardcodes no booking/acceptance/dispatch/payment/capture/completion/execution/send/provider-message/delivery", () => {
    const gateDecision = makeMockGateDecision("proposal_approved_for_next_step_only");
    const cmd = evaluateVendorProposalApprovalGateRecording({
      gateDecision,
      identifiers: mockIdentifiers,
      idempotencyKeyInput: "idemp-abc",
      proposalSnapshot: mockProposalSnapshot,
      now: NOW,
    });

    expect(cmd.booked).toBe(false);
    expect(cmd.accepted).toBe(false);
    expect(cmd.dispatched).toBe(false);
    expect(cmd.paid).toBe(false);
    expect(cmd.captured).toBe(false);
    expect(cmd.completed).toBe(false);
    expect(cmd.selectedForExecution).toBe(false);
    expect(cmd.providerAccepted).toBe(false);
    expect(cmd.bookingVerified).toBe(false);
    expect(cmd.paymentAuthorized).toBe(false);
    expect(cmd.paymentCaptured).toBe(false);
    expect(cmd.invoiceCreated).toBe(false);
    expect(cmd.payableCreated).toBe(false);
    expect(cmd.outreachSent).toBe(false);
    expect(cmd.providerMessageCreated).toBe(false);
    expect(cmd.deliveryVerified).toBe(false);
  });
});

describe("vendor proposal approval gate recording policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no SQL/DDL/migration files", () => {
    const source = fs.readFileSync("server/procurement/vendorProposalApprovalGateRecordingPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
