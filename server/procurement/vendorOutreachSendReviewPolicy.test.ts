import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateVendorOutreachSendReview,
  vendorOutreachSendReviewGateKey,
} from "./vendorOutreachSendReviewPolicy";
import type { OutreachSendReadinessDecision } from "./outreachSendReadinessPolicy";
import type { LegalDocumentPolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

function dryRunSendReadiness(patch: Partial<OutreachSendReadinessDecision> = {}): OutreachSendReadinessDecision {
  return {
    status: "blocked_for_live_send", evaluationMode: "dry_run_only", sendOutcome: "no_send_performed",
    eligibleForFutureSendAttempt: true, dryRunOnly: true, noSendPerformed: true, liveSendAllowed: false,
    reasons: ["vendor_outreach_feature_flag_off"],
    ...patch,
  };
}

function template(patch: Partial<OutreachTemplatePolicyView> = {}): OutreachTemplatePolicyView {
  return {
    templateKey: "vendor_availability_request", version: "v1", status: "approved",
    templatePurpose: "vendor_availability_request", subjectTemplate: "Quick question",
    bodyTemplate: "Hi {{vendorName}}, checking availability only -- no commitment yet.",
    bodyHash: "a".repeat(64),
    approvedAt: new Date("2026-06-01T00:00:00.000Z"), effectiveAt: new Date("2026-06-02T00:00:00.000Z"),
    retiredAt: null, requiredLegalDocumentKey: null, requiredLegalDocumentVersion: null,
    ...patch,
  };
}

function baseInput(patch: Partial<Parameters<typeof evaluateVendorOutreachSendReview>[0]> = {}) {
  return {
    draftId: "draft-1", candidateId: "candidate-1", workflowId: "workflow-1",
    draftStatus: "draft", draftBridgeStatus: "draft_created_internally",
    sendReadiness: dryRunSendReadiness(), subjectRendered: "Quick question",
    bodyRendered: "Hi Acme Dog Grooming, checking availability only -- no commitment yet.",
    template: template(), legalDocument: null, gate: null, now: NOW,
    ...patch,
  };
}

describe("evaluateVendorOutreachSendReview", () => {
  it("an eligible draft with no gate yet requires a send-review gate", () => {
    const decision = evaluateVendorOutreachSendReview(baseInput());
    expect(decision.status).toBe("awaiting_operator_send_review");
    expect(decision.sendReviewAllowed).toBe(true);
    expect(decision.gateRequired).toBe(true);
    expect(decision.requiredGateKey).toBe(vendorOutreachSendReviewGateKey({ draftId: "draft-1" }));
  });

  it("a draft not created internally cannot request send review", () => {
    for (const draftBridgeStatus of ["draft_not_allowed", "draft_requirements_missing", null]) {
      const decision = evaluateVendorOutreachSendReview(baseInput({ draftBridgeStatus }));
      expect(decision.status).toBe("send_review_not_allowed");
      expect(decision.sendReviewAllowed).toBe(false);
    }
  });

  it("a draft_status other than draft fails closed", () => {
    for (const draftStatus of ["needs_operator_review", "approved_for_manual_send", "rejected", "archived"]) {
      const decision = evaluateVendorOutreachSendReview(baseInput({ draftStatus }));
      expect(decision.status).toBe("send_review_not_allowed");
    }
  });

  it("missing draft id, candidate id, or workflow id fails closed", () => {
    expect(evaluateVendorOutreachSendReview(baseInput({ draftId: null })).status).toBe("send_review_not_allowed");
    expect(evaluateVendorOutreachSendReview(baseInput({ candidateId: null })).status).toBe("send_review_not_allowed");
    expect(evaluateVendorOutreachSendReview(baseInput({ workflowId: null })).status).toBe("send_review_not_allowed");
  });

  it("a missing template blocks with send_review_requirements_missing", () => {
    const decision = evaluateVendorOutreachSendReview(baseInput({ template: null }));
    expect(decision.status).toBe("send_review_requirements_missing");
    expect(decision.sendReviewAllowed).toBe(false);
  });

  it("a missing required legal document blocks with send_review_requirements_missing", () => {
    const decision = evaluateVendorOutreachSendReview(baseInput({
      template: template({ requiredLegalDocumentKey: "vendor_agreement", requiredLegalDocumentVersion: "v1" }),
      legalDocument: null,
    }));
    expect(decision.status).toBe("send_review_requirements_missing");
    expect(decision.reasons.join(",")).toMatch(/legal_document/);
  });

  it("a usable required legal document allows the gate to be requested", () => {
    const legalDocument: LegalDocumentPolicyView = {
      documentKey: "vendor_agreement", version: "v1", status: "approved",
      bodyHash: "b".repeat(64), termsHash: "c".repeat(64),
      approvedAt: new Date("2026-06-01T00:00:00.000Z"), effectiveAt: new Date("2026-06-02T00:00:00.000Z"),
      retiredAt: null,
    };
    const decision = evaluateVendorOutreachSendReview(baseInput({
      template: template({ requiredLegalDocumentKey: "vendor_agreement", requiredLegalDocumentVersion: "v1" }),
      legalDocument,
    }));
    expect(decision.status).toBe("awaiting_operator_send_review");
  });

  it("each banned claim blocks send review", () => {
    const bannedPhrases = [
      "you are booked", "you have been selected for execution", "this is an approved vendor",
      "guaranteed volume", "guaranteed payment", "guaranteed dispatch", "resident committed",
      "payment captured", "already assigned",
    ];
    for (const phrase of bannedPhrases) {
      const decision = evaluateVendorOutreachSendReview(baseInput({ bodyRendered: `Hi vendor, ${phrase}.` }));
      expect(decision.status).toBe("send_review_requirements_missing");
      expect(decision.reasons).toContain("rendered_draft_banned_claim");
    }
  });

  it("live send remains disabled -- liveSendReady is always false regardless of decision branch", () => {
    for (const decision of [
      evaluateVendorOutreachSendReview(baseInput()),
      evaluateVendorOutreachSendReview(baseInput({ draftStatus: "rejected" })),
      evaluateVendorOutreachSendReview(baseInput({ template: null })),
      evaluateVendorOutreachSendReview(baseInput({ gate: { gateKey: vendorOutreachSendReviewGateKey({ draftId: "draft-1" }), status: "approved", deadlineAt: null, decidedAt: new Date("2026-06-19T00:00:00.000Z") } })),
    ]) {
      expect(decision.liveSendReady).toBe(false);
    }
  });

  it("an operator gate that is pending returns awaiting_operator_send_review", () => {
    const decision = evaluateVendorOutreachSendReview(baseInput({
      gate: { gateKey: vendorOutreachSendReviewGateKey({ draftId: "draft-1" }), status: "pending", deadlineAt: null, decidedAt: null },
    }));
    expect(decision.status).toBe("awaiting_operator_send_review");
  });

  it("an operator gate that is approved returns operator_approved_for_manual_send_only, never sent", () => {
    const decision = evaluateVendorOutreachSendReview(baseInput({
      gate: {
        gateKey: vendorOutreachSendReviewGateKey({ draftId: "draft-1" }), status: "approved",
        deadlineAt: null, decidedAt: new Date("2026-06-19T00:00:00.000Z"),
      },
    }));
    expect(decision.status).toBe("operator_approved_for_manual_send_only");
    expect(decision.operatorApprovedForManualSendOnly).toBe(true);
    expect(decision.outreachSent).toBe(false);
  });

  it("an operator gate that is rejected, expired, or cancelled blocks with operator_rejected_send", () => {
    for (const status of ["rejected", "expired", "cancelled"] as const) {
      const decision = evaluateVendorOutreachSendReview(baseInput({
        gate: { gateKey: vendorOutreachSendReviewGateKey({ draftId: "draft-1" }), status, deadlineAt: null, decidedAt: new Date("2026-06-19T00:00:00.000Z") },
      }));
      expect(decision.status).toBe("operator_rejected_send");
    }
  });

  it("hardcodes no send/contact/provider-message/delivery/payment/dispatch/completion on every decision", () => {
    for (const decision of [
      evaluateVendorOutreachSendReview(baseInput()),
      evaluateVendorOutreachSendReview(baseInput({ draftStatus: "rejected" })),
      evaluateVendorOutreachSendReview(baseInput({
        gate: { gateKey: vendorOutreachSendReviewGateKey({ draftId: "draft-1" }), status: "approved", deadlineAt: null, decidedAt: new Date("2026-06-19T00:00:00.000Z") },
      })),
    ]) {
      expect(decision.outreachSent).toBe(false);
      expect(decision.vendorContacted).toBe(false);
      expect(decision.providerMessageCreated).toBe(false);
      expect(decision.deliveryAttempted).toBe(false);
      expect(decision.booked).toBe(false);
      expect(decision.accepted).toBe(false);
      expect(decision.dispatched).toBe(false);
      expect(decision.paid).toBe(false);
      expect(decision.captured).toBe(false);
      expect(decision.completed).toBe(false);
      expect(decision.liveSendReady).toBe(false);
    }
  });

  it("produces a deterministic gate key", () => {
    expect(vendorOutreachSendReviewGateKey({ draftId: "draft-1" })).toBe("vendor_outreach_send_review:draft-1");
    expect(vendorOutreachSendReviewGateKey({ draftId: "draft-1" })).toBe(vendorOutreachSendReviewGateKey({ draftId: "draft-1" }));
  });
});

describe("vendor outreach send review policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no writes", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachSendReviewPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
    expect(source).not.toMatch(/sent_at|delivery_status|send_status|provider_message_id/i);
  });
});
