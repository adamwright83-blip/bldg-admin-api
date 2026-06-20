import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { evaluateVendorOutreachDraftBridge } from "./vendorOutreachDraftBridgePolicy";
import type { LegalDocumentPolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";
import type { VendorMatchOperatorReviewStatus } from "./vendorMatchOperatorReviewPolicy";

const NOW = new Date("2026-06-19T12:00:00.000Z");

function template(patch: Partial<OutreachTemplatePolicyView> = {}): OutreachTemplatePolicyView {
  return {
    templateKey: "vendor_availability_request", version: "v1", status: "approved",
    templatePurpose: "vendor_availability_request",
    subjectTemplate: "Quick question about {{category}}",
    bodyTemplate: "Hi {{vendorName}}, would you be able to support a {{category}} request in {{area}}? No commitment yet -- just checking availability.",
    bodyHash: "a".repeat(64),
    approvedAt: new Date("2026-06-01T00:00:00.000Z"), effectiveAt: new Date("2026-06-02T00:00:00.000Z"),
    retiredAt: null, requiredLegalDocumentKey: null, requiredLegalDocumentVersion: null,
    ...patch,
  };
}

const variables = { vendorName: "Acme Dog Grooming", category: "dog grooming", area: "downtown" };

function baseInput(patch: Partial<{
  operatorReviewStatus: VendorMatchOperatorReviewStatus;
  evaluationRunId: string | null; candidateId: string | null;
  template: OutreachTemplatePolicyView | null; legalDocument: LegalDocumentPolicyView | null;
}> = {}) {
  return {
    operatorReviewStatus: "operator_approved_for_draft_only" as VendorMatchOperatorReviewStatus,
    evaluationRunId: "run-1", candidateId: "candidate-1",
    template: template(), legalDocument: null, lintRules: [], variables, now: NOW,
    ...patch,
  };
}

describe("evaluateVendorOutreachDraftBridge", () => {
  it("operator_approved_for_draft_only with a clean approved template produces draft_ready_to_create", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput());
    expect(decision.status).toBe("draft_ready_to_create");
    expect(decision.draftAllowed).toBe(true);
    expect(decision.bodyRendered).toContain("Acme Dog Grooming");
  });

  it("awaiting_operator_review cannot create a draft", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput({ operatorReviewStatus: "awaiting_operator_review" }));
    expect(decision.status).toBe("draft_not_allowed");
    expect(decision.draftAllowed).toBe(false);
  });

  it("operator_rejected cannot create a draft", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput({ operatorReviewStatus: "operator_rejected" }));
    expect(decision.status).toBe("draft_not_allowed");
  });

  it("review_not_allowed cannot create a draft", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput({ operatorReviewStatus: "review_not_allowed" }));
    expect(decision.status).toBe("draft_not_allowed");
  });

  it("a matched candidate with review_required (not yet approved) cannot create a draft", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput({ operatorReviewStatus: "review_required" }));
    expect(decision.status).toBe("draft_not_allowed");
    expect(decision.draftAllowed).toBe(false);
  });

  it("blocks when the template is missing or not approved/effective", () => {
    const missing = evaluateVendorOutreachDraftBridge(baseInput({ template: null }));
    expect(missing.status).toBe("draft_requirements_missing");

    const unapproved = evaluateVendorOutreachDraftBridge(baseInput({ template: template({ status: "draft" }) }));
    expect(unapproved.status).toBe("draft_requirements_missing");
  });

  it("blocks when a required legal document is missing or not usable", () => {
    const decision = evaluateVendorOutreachDraftBridge(baseInput({
      template: template({ requiredLegalDocumentKey: "vendor_agreement", requiredLegalDocumentVersion: "v1" }),
      legalDocument: null,
    }));
    expect(decision.status).toBe("draft_requirements_missing");
    expect(decision.reasons.join(",")).toMatch(/legal_document/);
  });

  it("fails closed for missing evaluation run id or candidate id", () => {
    expect(evaluateVendorOutreachDraftBridge(baseInput({ evaluationRunId: null })).status).toBe("draft_not_allowed");
    expect(evaluateVendorOutreachDraftBridge(baseInput({ candidateId: null })).status).toBe("draft_not_allowed");
  });

  it("draft copy contains no booked/paid/dispatched/accepted/selected-for-execution language", () => {
    const bannedTemplate = template({
      bodyTemplate: "Hi {{vendorName}}, you are booked and guaranteed payment for this dispatch -- you have been selected for this execution.",
    });
    const decision = evaluateVendorOutreachDraftBridge(baseInput({ template: bannedTemplate }));
    expect(decision.status).toBe("draft_requirements_missing");
    expect(decision.draftAllowed).toBe(false);
  });

  it("hardcodes no send/contact/provider-message/delivery/payment/dispatch/completion on every decision", () => {
    for (const decision of [
      evaluateVendorOutreachDraftBridge(baseInput()),
      evaluateVendorOutreachDraftBridge(baseInput({ operatorReviewStatus: "operator_rejected" })),
      evaluateVendorOutreachDraftBridge(baseInput({ template: null })),
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
    }
  });

  it("is deterministic interpolation only, with no LLM/external call", () => {
    const externalCall = vi.fn();
    vi.stubGlobal("fetch", externalCall);
    const input = baseInput();
    expect(evaluateVendorOutreachDraftBridge(input)).toEqual(evaluateVendorOutreachDraftBridge(input));
    expect(externalCall).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("vendor outreach draft bridge policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachDraftBridgePolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|llm/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
