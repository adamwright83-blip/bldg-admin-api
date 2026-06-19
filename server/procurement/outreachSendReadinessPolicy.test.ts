import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateOutreachSendReadiness, type OutreachSendReadinessInput } from "./outreachSendReadinessPolicy";

const readyInput = (patch: Partial<OutreachSendReadinessInput> = {}): OutreachSendReadinessInput => ({
  candidateStatus: "approved_for_outreach",
  templateStatus: "approved",
  templateEffective: true,
  lintClean: true,
  legalDocumentRequired: true,
  legalDocumentUsable: true,
  operatorGateStatus: "approved",
  channel: "email",
  draftStatus: "approved_for_manual_send",
  vendorOutreachEnabled: false,
  ...patch,
});

describe("outreach send readiness dry-run policy", () => {
  it("blocks live send while the feature flag is off", () => {
    expect(evaluateOutreachSendReadiness(readyInput())).toEqual({
      status: "blocked_for_live_send",
      evaluationMode: "dry_run_only",
      sendOutcome: "no_send_performed",
      eligibleForFutureSendAttempt: true,
      dryRunOnly: true,
      noSendPerformed: true,
      liveSendAllowed: false,
      reasons: ["vendor_outreach_feature_flag_off"],
    });
  });

  it("does not send when an operator gate is approved", () => {
    const decision = evaluateOutreachSendReadiness(readyInput({ vendorOutreachEnabled: true }));
    expect(decision).toMatchObject({ status: "dry_run_only", eligibleForFutureSendAttempt: true,
      evaluationMode: "dry_run_only", sendOutcome: "no_send_performed",
      dryRunOnly: true, noSendPerformed: true, liveSendAllowed: false });
  });

  it("blocks a lint failure", () => {
    const decision = evaluateOutreachSendReadiness(readyInput({ lintClean: false }));
    expect(decision.eligibleForFutureSendAttempt).toBe(false);
    expect(decision.reasons).toContain("draft_lint_not_clean");
  });

  it("blocks a missing required legal document", () => {
    const decision = evaluateOutreachSendReadiness(readyInput({ legalDocumentUsable: false }));
    expect(decision.eligibleForFutureSendAttempt).toBe(false);
    expect(decision.reasons).toContain("required_legal_document_not_usable");
  });

  it("blocks a bad draft status", () => {
    const decision = evaluateOutreachSendReadiness(readyInput({ draftStatus: "needs_operator_review" }));
    expect(decision.eligibleForFutureSendAttempt).toBe(false);
    expect(decision.reasons).toContain("draft_status_not_approved_for_manual_send");
  });

  it.each([
    ["candidate", { candidateStatus: "pending_operator_review" }, "candidate_not_approved_for_outreach"],
    ["template", { templateStatus: "draft" }, "template_not_approved_effective"],
    ["gate", { operatorGateStatus: "pending" }, "operator_gate_not_approved"],
    ["channel", { channel: "phone" }, "outreach_channel_not_allowed"],
  ] as const)("fails closed for an invalid %s", (_name, patch, reason) => {
    const decision = evaluateOutreachSendReadiness(readyInput(patch));
    expect(decision.eligibleForFutureSendAttempt).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("returns no send-provider or delivery artifacts", () => {
    const decision = evaluateOutreachSendReadiness(readyInput({ vendorOutreachEnabled: true }));
    expect(decision).not.toHaveProperty("provider_message_id");
    expect(decision).not.toHaveProperty("providerMessageId");
    expect(decision).not.toHaveProperty("sent_at");
    expect(decision).not.toHaveProperty("sentAt");
    expect(decision).not.toHaveProperty("delivery_status");
    expect(decision).not.toHaveProperty("deliveryStatus");
  });

  it("contains no I/O, route, worker, or provider implementation", () => {
    const source = fs.readFileSync("server/procurement/outreachSendReadinessPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|sendgrid|twilio|nodemailer)\b/i);
    expect(source).not.toMatch(/\b(router|procedure|worker|queue|execute|insert|update|delete)\b/i);
  });
});
