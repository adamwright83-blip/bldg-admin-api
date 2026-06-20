import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateVendorProposalApprovalGate,
  type ProposalSnapshot,
  type MandateRequestContext,
  type BudgetContext,
  type ResidentApprovalContext,
  type OperatorGateSnapshot,
  type PaymentAuthorizationContext,
  type LegalReviewContext,
} from "./vendorProposalApprovalGatePolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

const defaultProposal: ProposalSnapshot = {
  status: "proposal_ready_for_review",
  allowed: true,
  reasons: [],
  riskFlags: [],
  selectedTermsId: "terms-1",
  proposalDetails: {
    candidateId: "candidate-1",
    quotedAmountCents: 12000, // $120.00
    currency: "USD",
    rateUnit: "hour",
    confidence: "high",
  },
  expiresAt: new Date("2026-06-21T12:00:00.000Z"),
};

const defaultRequestContext: MandateRequestContext = {
  workflowId: "workflow-1",
  serviceType: "laundry",
  accessPattern: "lockbox",
};

const defaultBudgetContext: BudgetContext = {
  mandateBudgetLimitCents: 15000, // $150.00
};

const defaultResidentApprovalContext: ResidentApprovalContext = {
  approved: false,
};

describe("evaluateVendorProposalApprovalGate -- logic cases", () => {
  it("clean proposal under budget can become proposal_approved_for_next_step_only without execution", () => {
    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_approved_for_next_step_only");
    expect(decision.allowed).toBe(true);
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
  });

  it("expired proposal is not allowed", () => {
    const expiredProposal = {
      ...defaultProposal,
      expiresAt: new Date("2026-06-19T12:00:00.000Z"), // expired
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: expiredProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_approval_not_allowed");
    expect(decision.reasons).toContain("proposal_terms_expired");
    expect(decision.allowed).toBe(false);
  });

  it("proposal not ready for review is not allowed", () => {
    const notReadyProposal = {
      ...defaultProposal,
      status: "proposal_requirements_missing",
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: notReadyProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_approval_not_allowed");
    expect(decision.reasons[0]).toContain("proposal_status_forbidden");
    expect(decision.allowed).toBe(false);
  });

  it("risky proposal requires operator review", () => {
    // 1. low confidence terms
    const lowConfProposal = {
      ...defaultProposal,
      proposalDetails: {
        ...defaultProposal.proposalDetails!,
        confidence: "low" as const,
      },
    };

    const decision1 = evaluateVendorProposalApprovalGate({
      proposal: lowConfProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision1.status).toBe("proposal_requires_operator_review");
    expect(decision1.reasons).toContain("low_confidence_terms");

    // 2. risk flags present
    const riskProposal = {
      ...defaultProposal,
      riskFlags: ["expires_soon"],
    };

    const decision2 = evaluateVendorProposalApprovalGate({
      proposal: riskProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision2.status).toBe("proposal_requires_operator_review");
    expect(decision2.reasons).toContain("proposal_risk_flags_present");

    // 3. Approved operator gate resolves operator review
    const approvedGate: OperatorGateSnapshot = {
      status: "approved",
      decidedAt: NOW,
    };

    const decision3 = evaluateVendorProposalApprovalGate({
      proposal: riskProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: approvedGate,
      now: NOW,
    });

    expect(decision3.status).toBe("proposal_approved_for_next_step_only");
  });

  it("over-budget proposal requires resident/budget approval", () => {
    const expensiveProposal = {
      ...defaultProposal,
      proposalDetails: {
        ...defaultProposal.proposalDetails!,
        quotedAmountCents: 20000, // exceeds budget of 15000
      },
    };

    // requires resident approval first
    const decision1 = evaluateVendorProposalApprovalGate({
      proposal: expensiveProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });
    expect(decision1.status).toBe("proposal_requires_resident_approval");
    expect(decision1.reasons).toContain("exceeds_mandate_budget");

    // with resident approval, now requires budget approval
    const residentApprovedContext = {
      ...defaultResidentApprovalContext,
      approved: true,
    };
    const decision2 = evaluateVendorProposalApprovalGate({
      proposal: expensiveProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: residentApprovedContext,
      operatorGate: null,
      now: NOW,
    });
    expect(decision2.status).toBe("proposal_requires_budget_approval");
    expect(decision2.reasons).toContain("exceeds_mandate_budget");

    // with both approvals, it becomes approved
    const budgetApprovedContext = {
      ...defaultBudgetContext,
      approved: true,
    };
    const decision3 = evaluateVendorProposalApprovalGate({
      proposal: expensiveProposal,
      requestContext: defaultRequestContext,
      budgetContext: budgetApprovedContext,
      residentApprovalContext: residentApprovedContext,
      operatorGate: null,
      now: NOW,
    });
    expect(decision3.status).toBe("proposal_approved_for_next_step_only");
  });

  it("schedule/access change requires resident approval", () => {
    // material schedule change
    const scheduleChangeContext = {
      ...defaultRequestContext,
      scheduleChangedMaterially: true,
    };
    const decision1 = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: scheduleChangeContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });
    expect(decision1.status).toBe("proposal_requires_resident_approval");
    expect(decision1.reasons).toContain("schedule_changed_materially");

    // resident presence required
    const accessChangeContext = {
      ...defaultRequestContext,
      accessPattern: "resident_present",
    };
    const decision2 = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: accessChangeContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });
    expect(decision2.status).toBe("proposal_requires_resident_approval");
    expect(decision2.reasons).toContain("resident_presence_required");
  });

  it("funds-required proposal requires payment authorization but does not authorize payment", () => {
    const paymentAuthorizationContext: PaymentAuthorizationContext = {
      requiresFundsReservation: true,
      authorized: false,
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      paymentAuthorizationContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_requires_payment_authorization");
    expect(decision.reasons).toContain("payment_authorization_pending");
    expect(decision.paymentAuthorized).toBe(false); // does not authorize payment
  });

  it("unusual legal terms require legal review", () => {
    const legalReviewContext: LegalReviewContext = {
      unusualLiability: true,
      approved: false,
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      legalReviewContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_requires_legal_review");
    expect(decision.reasons).toContain("legal_review_pending");
  });

  it("rejected gate returns proposal_rejected", () => {
    const rejectedGate: OperatorGateSnapshot = {
      status: "rejected",
      decidedAt: NOW,
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: rejectedGate,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_rejected");
    expect(decision.allowed).toBe(false);
  });

  it("approved gate returns next-step-only, not execution", () => {
    const approvedGate: OperatorGateSnapshot = {
      status: "approved",
      decidedAt: NOW,
    };

    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: approvedGate,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_approved_for_next_step_only");
    expect(decision.allowed).toBe(true);
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.dispatched).toBe(false);
    expect(decision.completed).toBe(false);
    expect(decision.selectedForExecution).toBe(false);
  });

  it("output hardcodes no booking/acceptance/dispatch/payment/capture/completion/execution", () => {
    const decision = evaluateVendorProposalApprovalGate({
      proposal: defaultProposal,
      requestContext: defaultRequestContext,
      budgetContext: defaultBudgetContext,
      residentApprovalContext: defaultResidentApprovalContext,
      operatorGate: null,
      now: NOW,
    });

    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.dispatched).toBe(false);
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
    expect(decision.completed).toBe(false);
    expect(decision.selectedForExecution).toBe(false);
    expect(decision.providerAccepted).toBe(false);
    expect(decision.bookingVerified).toBe(false);
    expect(decision.paymentAuthorized).toBe(false);
    expect(decision.paymentCaptured).toBe(false);
    expect(decision.invoiceCreated).toBe(false);
    expect(decision.payableCreated).toBe(false);
  });
});

describe("vendor proposal approval gate policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no SQL/DDL/migration files", () => {
    const source = fs.readFileSync("server/procurement/vendorProposalApprovalGatePolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
