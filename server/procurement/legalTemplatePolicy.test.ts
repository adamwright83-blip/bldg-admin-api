import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canUseLegalDocument,
  evaluateTemplateForUse,
  lintOutreachTemplate,
  type LegalDocumentPolicyView,
  type OutreachTemplatePolicyView,
} from "./legalTemplatePolicy";
import { LegalTemplateStore } from "./legalTemplateStore";

const now = new Date("2026-06-19T12:00:00.000Z");
const hash = "a".repeat(64);
const document = (patch: Partial<LegalDocumentPolicyView> = {}): LegalDocumentPolicyView => ({
  documentKey: "vendor_agreement", version: "1", status: "approved", bodyHash: hash,
  termsHash: hash, approvedAt: new Date("2026-06-18"), effectiveAt: new Date("2026-06-18"),
  retiredAt: null, ...patch,
});
const template = (patch: Partial<OutreachTemplatePolicyView> = {}): OutreachTemplatePolicyView => ({
  templateKey: "vendor_availability", version: "1", status: "approved",
  templatePurpose: "vendor_availability_request", subjectTemplate: "Availability request",
  bodyTemplate: "Please share your public availability.", bodyHash: hash,
  approvedAt: new Date("2026-06-18"), effectiveAt: new Date("2026-06-18"), retiredAt: null,
  requiredLegalDocumentKey: "vendor_agreement", requiredLegalDocumentVersion: "1", ...patch,
});

describe("legal and outreach template policy", () => {
  it("allows only approved, effective, non-retired legal versions with valid hashes", () => {
    expect(canUseLegalDocument(document(), now)).toBe(true);
    expect(canUseLegalDocument(document({ status: "draft" }), now)).toBe(false);
    expect(canUseLegalDocument(document({ effectiveAt: new Date("2026-06-20") }), now)).toBe(false);
    expect(canUseLegalDocument(document({ status: "retired", retiredAt: now }), now)).toBe(false);
    expect(canUseLegalDocument(document({ termsHash: "invalid" }), now)).toBe(false);
  });

  it("allows an approved, effective, lint-clean template with its exact legal version", () => {
    expect(evaluateTemplateForUse({ template: template(), requiredLegalDocument: document(),
      lintRules: [], now })).toMatchObject({ usable: true, reasons: [] });
  });

  it("fails closed for missing, draft, unapproved, future, or retired templates", () => {
    expect(evaluateTemplateForUse({ template: null, requiredLegalDocument: null,
      lintRules: [], now }).usable).toBe(false);
    for (const value of [
      template({ status: "draft", approvedAt: null }),
      template({ approvedAt: null }),
      template({ effectiveAt: new Date("2026-06-20") }),
      template({ status: "retired", retiredAt: now }),
    ]) expect(evaluateTemplateForUse({ template: value, requiredLegalDocument: document(),
      lintRules: [], now }).usable).toBe(false);
  });

  it("requires the exact usable legal document version", () => {
    const decision = evaluateTemplateForUse({ template: template(),
      requiredLegalDocument: document({ version: "2" }), lintRules: [], now });
    expect(decision.usable).toBe(false);
    expect(decision.reasons).toContain("required_legal_document_version_mismatch");
  });

  it.each([
    "Act now, spots are filling fast",
    "Guaranteed booking",
    "Lowest price guaranteed",
    "We are your exclusive provider",
    "Recommended by your building",
    "You are booked",
  ])("blocks built-in banned claim: %s", bodyTemplate => {
    const result = lintOutreachTemplate(template({ bodyTemplate }), []);
    expect(result.blockingLintRules.length).toBeGreaterThan(0);
  });

  it("enforces active registry lint rules deterministically", () => {
    const result = evaluateTemplateForUse({ template: template(), requiredLegalDocument: document(), now,
      lintRules: [{ ruleKey: "disclosure", ruleType: "required_disclosure", severity: "block",
        patternOrClaim: "No booking is confirmed", appliesToPurpose: "vendor_availability_request", status: "active" }] });
    expect(result.usable).toBe(false);
    expect(result.blockingLintRules).toContain("disclosure");
  });
});

describe("legal template registry isolation", () => {
  it("migration defines version/status/hash contracts and contains no seed writes", () => {
    const sql = fs.readFileSync("procurement/migrations/0008_legal_template_registry.sql", "utf8");
    expect(sql).toContain("legal_document_versions");
    expect(sql).toContain("outreach_template_versions");
    expect(sql).toContain("outreach_template_lint_rules");
    expect(sql).toContain("`terms_hash` char(64)");
    expect(sql).toContain("`body_hash` char(64)");
    expect(sql).toContain("enum('draft','approved','retired')");
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
  });

  it("store creates draft registry records only and writes only new tables", async () => {
    const connection = { beginTransaction: vi.fn(), execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]),
      commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const store = new LegalTemplateStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createLegalDocumentVersion({ id: "doc-1", documentKey: "vendor_agreement",
      documentType: "vendor_agreement", version: "1", title: "Agreement", bodyTemplate: "Draft",
      bodyHash: hash, variableSchema: {}, jurisdiction: "US-CA", locale: "en-US",
      termsVersion: "1", termsHash: hash, evidence: {}, createdBy: "operator-1" });
    await store.createOutreachTemplateVersion({ id: "template-1", templateKey: "availability",
      outreachChannel: "email", templatePurpose: "vendor_availability_request", version: "1",
      bodyTemplate: "Draft only", bodyHash: hash, variableSchema: {}, evidence: {}, createdBy: "operator-1" });
    await store.createLintRule({ ruleKey: "no_fake_booking", ruleType: "banned_claim",
      severity: "block", patternOrClaim: "you are booked" });
    const statements = connection.execute.mock.calls.map(call => String(call[0])).join("\n");
    expect(statements).toMatch(/INSERT INTO legal_document_versions/);
    expect(statements).toMatch(/INSERT INTO outreach_template_versions/);
    expect(statements).toMatch(/INSERT INTO outreach_template_lint_rules/);
    expect(statements).not.toMatch(/INSERT\s+INTO\s+(vendors|vendorProfiles|vendorServices)\b/i);
    expect(statements).not.toMatch(/\b(fetch|send|message|stripe|payment|accept_agreement)\b/i);
    expect(connection.commit).toHaveBeenCalledTimes(3);
  });
});
