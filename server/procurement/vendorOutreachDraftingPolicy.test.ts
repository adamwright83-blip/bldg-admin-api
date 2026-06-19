import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { LegalDocumentPolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";
import { canRecordConversationEvidence, renderVendorOutreachDraft } from "./vendorOutreachDraftingPolicy";
import { VendorOutreachDraftingStore } from "./vendorOutreachDraftingStore";

const now = new Date("2026-06-19T12:00:00Z");
const hash = "a".repeat(64);
const legal: LegalDocumentPolicyView = { documentKey: "vendor_agreement", version: "1", status: "approved",
  bodyHash: hash, termsHash: hash, approvedAt: new Date("2026-06-18"), effectiveAt: new Date("2026-06-18"), retiredAt: null };
const template = (patch: Partial<OutreachTemplatePolicyView> = {}): OutreachTemplatePolicyView => ({
  templateKey: "availability", version: "1", status: "approved", templatePurpose: "vendor_availability_request",
  subjectTemplate: "Availability for {{building}}", bodyTemplate: "Can you share availability for {{building}}?",
  bodyHash: hash, approvedAt: new Date("2026-06-18"), effectiveAt: new Date("2026-06-18"), retiredAt: null,
  requiredLegalDocumentKey: "vendor_agreement", requiredLegalDocumentVersion: "1", ...patch });

describe("vendor outreach drafting policy", () => {
  it("renders a reviewable but never sendable draft", () => {
    const result = renderVendorOutreachDraft({ candidateStatus: "approved_for_outreach", template: template(),
      legalDocument: legal, lintRules: [], variables: { building: "Opus" }, now });
    expect(result).toMatchObject({ allowed: true, sendable: false, bodyRendered: "Can you share availability for Opus?" });
  });
  it("fails closed for a non-approved candidate", () => expect(renderVendorOutreachDraft({
    candidateStatus: "pending_operator_review", template: template(), legalDocument: legal,
    lintRules: [], variables: { building: "Opus" }, now }).allowed).toBe(false));
  it("fails for draft or retired templates", () => {
    for (const value of [template({ status: "draft" }), template({ status: "retired", retiredAt: now })])
      expect(renderVendorOutreachDraft({ candidateStatus: "approved_for_outreach", template: value,
        legalDocument: legal, lintRules: [], variables: { building: "Opus" }, now }).allowed).toBe(false);
  });
  it("fails for missing required legal document", () => expect(renderVendorOutreachDraft({
    candidateStatus: "approved_for_outreach", template: template(), legalDocument: null,
    lintRules: [], variables: { building: "Opus" }, now }).allowed).toBe(false));
  it.each(["Act now", "Guaranteed pricing", "You are booked"])("blocks rendered claim: %s", claim => {
    const result = renderVendorOutreachDraft({ candidateStatus: "approved_for_outreach",
      template: template({ bodyTemplate: "{{claim}}" }), legalDocument: legal,
      lintRules: [], variables: { claim }, now });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("rendered_draft_lint_blocked");
  });
  it("cannot bypass active public lint rules", () => {
    const result = renderVendorOutreachDraft({ candidateStatus: "approved_for_outreach",
      template: template(), legalDocument: legal, variables: { building: "Opus" }, now,
      lintRules: [{ ruleKey: "disclosure", ruleType: "required_disclosure", severity: "block",
        patternOrClaim: "No booking is confirmed", appliesToPurpose: null, status: "active" }] });
    expect(result.allowed).toBe(false);
  });
  it("conversation intake records evidence without acceptance", () => expect(canRecordConversationEvidence({
    direction: "inbound", summary: "Vendor replied", occurredAt: now })).toEqual({
      allowed: true, reasons: [], agreementAccepted: false, providerAccepted: false }));
});

describe("vendor outreach drafting persistence isolation", () => {
  it("schema contains no send/delivery/provider identifiers or seeds", () => {
    const sql = fs.readFileSync("procurement/migrations/0009_vendor_outreach_drafting_intake.sql", "utf8");
    expect(sql).not.toMatch(/`(sent_at|provider_message_id|webhook_send_id|delivery_status|delivered_at)`/i);
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
  });
  it("store conversation intake writes only the new event table", async () => {
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn().mockResolvedValueOnce([[{ id: "candidate-1" }], []])
        .mockResolvedValueOnce([[{ id: "42" }], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]) };
    const store = new VendorOutreachDraftingStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const result = await store.recordConversationEvent({ id: "event-1", candidateId: "candidate-1", tenantId: "default",
      direction: "inbound", channel: "email", occurredAt: now, summary: "Availability provided",
      rawPayload: {}, evidence: {}, createdBy: "operator-1" });
    expect(result).toEqual({ id: "event-1", agreementAccepted: false, providerAccepted: false });
    const writes = connection.execute.mock.calls.map(call => String(call[0])).filter(sql => /^\s*(INSERT|UPDATE)/i.test(sql)).join("\n");
    expect(writes).toMatch(/vendor_outreach_conversation_events/);
    expect(writes).not.toMatch(/\b(vendors|vendorProfiles|vendorServices|stripe|payment)\b/i);
    expect(writes).not.toMatch(/\b(send|dispatch|accept_agreement)\b/i);
  });
});
