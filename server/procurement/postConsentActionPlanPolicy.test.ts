import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { containsFounderEscalationLine, evaluatePostConsentActionPlan } from "./postConsentActionPlanPolicy";
import type { LintRulePolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";

const NOW = new Date("2026-06-22T12:00:00.000Z");
const SNAPSHOT_HASH = "a".repeat(64);

function proposal(patch: Partial<Parameters<typeof evaluatePostConsentActionPlan>[0]["proposal"]> = {}) {
  return {
    proposalId: "proposal-1", expired: false, readiness: "ready_for_admin_review" as const,
    jobCardReference: { snapshotHash: SNAPSHOT_HASH },
    jobCard: { category: "dog_grooming", serviceLabel: "Dog grooming", requestFacts: { dogSize: "medium" } },
    candidate: { id: "candidate-1", businessName: "Acme Grooming", category: "dog_grooming" },
    ...patch,
  };
}

function template(patch: Partial<OutreachTemplatePolicyView> = {}): OutreachTemplatePolicyView {
  return {
    templateKey: "vendor_availability_request_v0", version: "v1", status: "approved",
    templatePurpose: "vendor_availability_request",
    subjectTemplate: "Quick availability check",
    bodyTemplate: "Hi {{vendorName}}, the resident approved HELD to check whether you can do this for "
      + "{{serviceLabel}} around {{offeredWindow}}. Nothing is confirmed yet. We are confirming availability "
      + "first. Please reply with availability, price, and any requirements. "
      + "Speak to HELD founder directly: Adam Wright -- [cell phone] / [email].",
    bodyHash: "b".repeat(64),
    approvedAt: new Date("2026-06-01T00:00:00.000Z"), effectiveAt: new Date("2026-06-02T00:00:00.000Z"),
    retiredAt: null, requiredLegalDocumentKey: null, requiredLegalDocumentVersion: null,
    ...patch,
  };
}

const FOUNDER_LINE_RULE: LintRulePolicyView = {
  ruleKey: "founder_escalation_required", ruleType: "required_disclosure", severity: "block",
  patternOrClaim: "Speak to HELD founder directly", appliesToPurpose: "vendor_availability_request", status: "active",
};

function baseInput(patch: Partial<Parameters<typeof evaluatePostConsentActionPlan>[0]> = {}) {
  return {
    consentProposalVersionSnapshotHash: SNAPSHOT_HASH,
    proposal: proposal(),
    vendorContact: { hasUsableChannel: true },
    candidateSourcingStatus: "approved_for_outreach",
    template: template(),
    legalDocument: null,
    lintRules: [FOUNDER_LINE_RULE],
    variables: { vendorName: "Acme Grooming", serviceLabel: "Dog grooming", offeredWindow: "Jun 25, 10-11am" },
    now: NOW,
    ...patch,
  };
}

describe("evaluatePostConsentActionPlan", () => {
  it("creates a draft only when every gate passes", () => {
    const decision = evaluatePostConsentActionPlan(baseInput());
    expect(decision.status).toBe("draft_vendor_outreach");
    expect(decision.allowed).toBe(true);
    expect(decision.draftRendering?.allowed).toBe(true);
    expect(decision.draftRendering?.bodyRendered).toMatch(/Speak to HELD founder directly/);
  });

  it("creates a draft even when the proposal has no procurement workflow at all -- no workflow_id input exists anymore", () => {
    // This policy no longer takes or checks a workflowIdAvailable input. Resident-consented
    // proposals sourced from resident_coordinated_request (which have no procurement_workflows
    // row) must still be able to reach draft_vendor_outreach.
    const decision = evaluatePostConsentActionPlan(baseInput());
    expect(decision.status).toBe("draft_vendor_outreach");
    expect("workflowIdAvailable" in baseInput()).toBe(false);
  });

  it("rejects when the consent's snapshot hash input is missing", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ consentProposalVersionSnapshotHash: "" }));
    expect(decision.status).toBe("invalid_request");
  });

  it("blocks with blocked_terms_changed when the proposal cannot be found", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ proposal: null }));
    expect(decision.status).toBe("blocked_terms_changed");
    expect(decision.reasons).toContain("proposal_version_not_found");
  });

  it("blocks with blocked_terms_changed when the snapshot hash no longer matches consent (terms changed)", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({
      proposal: proposal({ jobCardReference: { snapshotHash: "c".repeat(64) } }),
    }));
    expect(decision.status).toBe("blocked_terms_changed");
    expect(decision.reasons).toContain("proposal_snapshot_hash_mismatch");
  });

  it("blocks with blocked_terms_changed when the proposal has been superseded", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ proposal: proposal({ readiness: "superseded" }) }));
    expect(decision.status).toBe("blocked_terms_changed");
    expect(decision.reasons).toContain("proposal_superseded");
  });

  it("blocks with blocked_expired when the proposal is expired", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ proposal: proposal({ expired: true }) }));
    expect(decision.status).toBe("blocked_expired");
  });

  it("blocks with blocked_missing_vendor_contact when no usable contact channel exists", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ vendorContact: { hasUsableChannel: false } }));
    expect(decision.status).toBe("blocked_missing_vendor_contact");
  });

  it("routes to needs_resident_clarification when request facts are missing", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({
      proposal: proposal({ jobCard: { category: "dog_grooming", serviceLabel: "Dog grooming", requestFacts: {} } }),
    }));
    expect(decision.status).toBe("needs_resident_clarification");
  });

  it("routes to needs_operator_review when the underlying proposal itself is unsafe or not ready", () => {
    for (const readiness of ["unsafe", "not_ready"] as const) {
      const decision = evaluatePostConsentActionPlan(baseInput({ proposal: proposal({ readiness }) }));
      expect(decision.status).toBe("needs_operator_review");
    }
  });

  it("blocks with blocked_unsafe_to_contact when the candidate is not approved for outreach", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ candidateSourcingStatus: "discovered" }));
    expect(decision.status).toBe("blocked_unsafe_to_contact");
  });

  it("blocks with blocked_unsafe_to_contact when the rendered draft contains a forbidden claim", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({
      variables: { vendorName: "Acme Grooming", serviceLabel: "Dog grooming",
        offeredWindow: "Jun 25, 10-11am -- you are confirmed" },
    }));
    expect(decision.status).toBe("blocked_unsafe_to_contact");
    expect(decision.reasons).toContain("rendered_draft_lint_blocked");
  });

  it("blocks the new forbidden phrases added for this slice", () => {
    const phrases = ["we have scheduled", "the resident has booked", "payment is ready", "you are confirmed"];
    for (const phrase of phrases) {
      const decision = evaluatePostConsentActionPlan(baseInput({
        variables: { vendorName: "Acme Grooming", serviceLabel: "Dog grooming", offeredWindow: phrase },
      }));
      expect(decision.status).toBe("blocked_unsafe_to_contact");
    }
  });

  it("requires the founder escalation line -- a template missing it fails the required-disclosure lint", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({
      template: template({ bodyTemplate: "Hi {{vendorName}}, nothing is confirmed yet. Please reply with availability." }),
    }));
    expect(decision.status).toBe("blocked_unsafe_to_contact");
    expect(decision.reasons).toContain("rendered_draft_lint_blocked");
  });

  it("routes to needs_resident_clarification when a template variable is missing", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ variables: { vendorName: "Acme Grooming" } }));
    expect(decision.status).toBe("needs_resident_clarification");
  });

  it("routes to needs_operator_review when the template itself is not approved/effective", () => {
    const decision = evaluatePostConsentActionPlan(baseInput({ template: null }));
    expect(decision.status).toBe("needs_operator_review");
  });

  it("hardcodes no send/contact/booking/payment/dispatch/completion/LLM behavior on every decision", () => {
    const decisions = [
      evaluatePostConsentActionPlan(baseInput()),
      evaluatePostConsentActionPlan(baseInput({ proposal: null })),
      evaluatePostConsentActionPlan(baseInput({ vendorContact: { hasUsableChannel: false } })),
    ];
    for (const decision of decisions) {
      expect(decision.eligibleForAutoSendPilot).toBe(false);
      expect(decision.outreachSent).toBe(false);
      expect(decision.vendorContacted).toBe(false);
      expect(decision.booked).toBe(false);
      expect(decision.accepted).toBe(false);
      expect(decision.paid).toBe(false);
      expect(decision.captured).toBe(false);
      expect(decision.dispatched).toBe(false);
      expect(decision.completed).toBe(false);
      expect(decision.llmCalled).toBe(false);
    }
  });
});

describe("post-consent action plan policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no writes", () => {
    const source = fs.readFileSync("server/procurement/postConsentActionPlanPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});

describe("containsFounderEscalationLine", () => {
  it("detects the line case-insensitively", () => {
    expect(containsFounderEscalationLine("Speak to HELD founder directly: Adam Wright.")).toBe(true);
    expect(containsFounderEscalationLine("speak to held founder directly")).toBe(true);
  });

  it("returns false when the line is absent", () => {
    expect(containsFounderEscalationLine("Nothing is confirmed yet.")).toBe(false);
  });
});
