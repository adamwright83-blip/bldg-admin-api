import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateVendorMatchOperatorReview,
  vendorMatchReviewGateKey,
  type VendorMatchOperatorReviewCandidateInput,
  type VendorMatchOperatorReviewGateView,
} from "./vendorMatchOperatorReviewPolicy";

const NOW = new Date("2026-06-19T12:00:00.000Z");

function candidate(patch: Partial<VendorMatchOperatorReviewCandidateInput> = {}): VendorMatchOperatorReviewCandidateInput {
  return { evaluationRunId: "run-1", candidateId: "candidate-1", matchStatus: "matched", ...patch };
}

function gate(patch: Partial<VendorMatchOperatorReviewGateView> = {}): VendorMatchOperatorReviewGateView {
  return {
    gateKey: vendorMatchReviewGateKey({ evaluationRunId: "run-1", candidateId: "candidate-1" }),
    status: "approved", deadlineAt: null, decidedAt: new Date("2026-06-19T00:00:00.000Z"),
    ...patch,
  };
}

describe("evaluateVendorMatchOperatorReview", () => {
  it("allows a matched candidate to request operator review", () => {
    const decision = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate(), gate: null, now: NOW,
    });
    expect(decision.status).toBe("review_required");
    expect(decision.reviewAllowed).toBe(true);
    expect(decision.operatorApprovedForDraftOnly).toBe(false);
  });

  it("requires operator review for a needs_review candidate but never approves it directly", () => {
    const decision = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "needs_operator_review",
      candidate: candidate({ matchStatus: "needs_review" }), gate: null, now: NOW,
    });
    expect(decision.status).toBe("review_required");
    expect(decision.operatorApprovedForDraftOnly).toBe(false);

    const withPendingGate = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "needs_operator_review",
      candidate: candidate({ matchStatus: "needs_review" }),
      gate: gate({ status: "pending" }), now: NOW,
    });
    expect(withPendingGate.status).toBe("awaiting_operator_review");
    expect(withPendingGate.operatorApprovedForDraftOnly).toBe(false);

    const withApprovedGate = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "needs_operator_review",
      candidate: candidate({ matchStatus: "needs_review" }),
      gate: gate({ status: "approved" }), now: NOW,
    });
    expect(withApprovedGate.status).not.toBe("operator_approved_for_draft_only");
  });

  it("fails closed for a not_matched candidate", () => {
    const decision = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate({ matchStatus: "not_matched" }), gate: null, now: NOW,
    });
    expect(decision.status).toBe("review_not_allowed");
    expect(decision.reviewAllowed).toBe(false);
  });

  it("fails closed for a blocked candidate", () => {
    const decision = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate({ matchStatus: "blocked" }), gate: null, now: NOW,
    });
    expect(decision.status).toBe("review_not_allowed");
    expect(decision.riskFlags).toContain("match_blocked");
  });

  it("fails closed for a cancelled or blocked evaluation run", () => {
    const cancelled = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "cancelled", candidate: candidate(), gate: null, now: NOW,
    });
    expect(cancelled.status).toBe("review_not_allowed");
    expect(cancelled.reasons).toContain("evaluation_run_cancelled");

    const blockedRun = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "blocked", candidate: candidate(), gate: null, now: NOW,
    });
    expect(blockedRun.status).toBe("review_not_allowed");
    expect(blockedRun.reasons).toContain("evaluation_run_blocked");
  });

  it("fails closed for missing evaluation run, missing ids, or a malformed candidate", () => {
    expect(evaluateVendorMatchOperatorReview({
      evaluationRunStatus: null, candidate: candidate(), gate: null, now: NOW,
    }).status).toBe("review_not_allowed");

    expect(evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate({ evaluationRunId: null }), gate: null, now: NOW,
    }).reasons).toContain("missing_evaluation_run_id");

    expect(evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate({ candidateId: null }), gate: null, now: NOW,
    }).reasons).toContain("missing_candidate_id");

    expect(evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated",
      candidate: null as unknown as VendorMatchOperatorReviewCandidateInput, gate: null, now: NOW,
    }).reasons).toContain("malformed_candidate");
  });

  it("permits only a draft-only next step on gate approval, never send/contact/book/dispatch/payment", () => {
    const decision = evaluateVendorMatchOperatorReview({
      evaluationRunStatus: "evaluated", candidate: candidate(), gate: gate({ status: "approved" }), now: NOW,
    });
    expect(decision.status).toBe("operator_approved_for_draft_only");
    expect(decision.operatorApprovedForDraftOnly).toBe(true);
    expect(decision.outreachSent).toBe(false);
    expect(decision.vendorSelectedForExecution).toBe(false);
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.dispatched).toBe(false);
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
    expect(decision.completed).toBe(false);
    expect(decision.contacted).toBe(false);
  });

  it("blocks the next step on gate rejection, expiry, or cancellation", () => {
    for (const status of ["rejected", "expired", "cancelled"] as const) {
      const decision = evaluateVendorMatchOperatorReview({
        evaluationRunStatus: "evaluated", candidate: candidate(), gate: gate({ status }), now: NOW,
      });
      expect(decision.status).toBe("operator_rejected");
      expect(decision.operatorApprovedForDraftOnly).toBe(false);
    }
  });

  it("produces a deterministic gate key", () => {
    const key = vendorMatchReviewGateKey({ evaluationRunId: "run-1", candidateId: "candidate-1" });
    expect(key).toBe("vendor_match_review:run-1:candidate-1");
    expect(vendorMatchReviewGateKey({ evaluationRunId: "run-1", candidateId: "candidate-1" })).toBe(key);
  });

  it("is deterministic and performs no external work", () => {
    const externalCall = vi.fn();
    vi.stubGlobal("fetch", externalCall);
    const input = { evaluationRunStatus: "evaluated" as const, candidate: candidate(), gate: null, now: NOW };
    expect(evaluateVendorMatchOperatorReview(input)).toEqual(evaluateVendorMatchOperatorReview(input));
    expect(externalCall).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("vendor match operator review policy source isolation", () => {
  it("never returns booked/contacted/dispatched/paid/captured/completed as true and contains no such mutation", () => {
    const source = fs.readFileSync("server/procurement/vendorMatchOperatorReviewPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
