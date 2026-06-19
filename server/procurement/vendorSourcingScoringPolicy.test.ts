import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canApproveForOutreach,
  evaluateVendorCandidate,
  outreachGateKey,
  type VendorScoringInput,
} from "./vendorSourcingScoringPolicy";
import { VendorSourcingScoringStore } from "./vendorSourcingScoringStore";

const input = (patch: Partial<VendorScoringInput> = {}): VendorScoringInput => ({
  sourceType: "public_business_directory",
  sourceCompliancePresent: true,
  candidateStatus: "discovered",
  categoryMatch: true,
  geographicCoverage: true,
  hasPublicContact: true,
  hasPricingSignal: true,
  hasBookingMechanism: false,
  reviewSignal: "neutral",
  ...patch,
});

describe("vendor sourcing scoring policy", () => {
  it("passes objective evidence only to operator review", () => {
    expect(evaluateVendorCandidate(input())).toMatchObject({
      allowed: true, decision: "pass_to_operator_review",
    });
  });

  it("fails closed without source compliance", () => {
    const decision = evaluateVendorCandidate(input({ sourceCompliancePresent: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("source_compliance_missing");
  });

  it("prevents unknown sources from passing", () => {
    expect(evaluateVendorCandidate(input({ sourceType: "unknown" })).decision).toBe("reject");
  });

  it("rejects a category mismatch", () => {
    expect(evaluateVendorCandidate(input({ categoryMatch: false })).decision).toBe("reject");
  });

  it("does not directly pass without public contact", () => {
    const decision = evaluateVendorCandidate(input({ hasPublicContact: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("public_contact_missing");
  });

  it("never permits review signal alone to pass", () => {
    const decision = evaluateVendorCandidate(input({ categoryMatch: null, geographicCoverage: null,
      hasPublicContact: false, hasPricingSignal: false, hasBookingMechanism: false,
      reviewSignal: "positive" }));
    expect(decision.allowed).toBe(false);
    expect(decision.scores.reviewSignal).toBe(10);
  });

  it("uses the required candidate-specific gate key", () => {
    expect(outreachGateKey("candidate-1")).toBe("vendor_outreach_approval:candidate-1");
  });

  it("requires the exact approved gate before outreach approval", () => {
    expect(canApproveForOutreach({ candidateId: "candidate-1", candidateStatus: "pending_operator_review",
      gateKey: outreachGateKey("candidate-1"), gateStatus: "pending" }).allowed).toBe(false);
    expect(canApproveForOutreach({ candidateId: "candidate-1", candidateStatus: "pending_operator_review",
      gateKey: outreachGateKey("candidate-1"), gateStatus: "approved" }).allowed).toBe(true);
  });
});

describe("vendor scoring persistence isolation", () => {
  it("migration adds only the score table and reuses the existing gate table", () => {
    const sql = fs.readFileSync("procurement/migrations/0007_vendor_sourcing_scoring_gate.sql", "utf8");
    expect(sql).toContain("vendor_sourcing_candidate_scores");
    expect(sql).not.toMatch(/CREATE TABLE[^;]+operator_gate/is);
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
    expect(sql).not.toMatch(/creditworthiness|protected_class|llm_vibe|vibe_score/i);
  });

  it("writes only scoring, candidate, workflow, and operator-gate tables", async () => {
    const candidateRow = { id: "candidate-1", tenant_id: "default",
      source_type: "public_business_directory", sourcing_status: "discovered",
      source_compliance_snapshot_json: { allowedUseFlags: { candidate_discovery: true },
        prohibitedUseFlags: { login_bypass: true }, sourcePolicy: { publicly_accessible_only: true } } };
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[candidateRow], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[{ id: "42" }], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
    };
    const store = new VendorSourcingScoringStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const result = await store.scoreCandidate({ id: "score-1", candidateId: "candidate-1",
      tenantId: "default", createdBy: "operator-1", evidence: { public: true },
      signals: { categoryMatch: true, geographicCoverage: true, hasPublicContact: true,
        hasPricingSignal: true, hasBookingMechanism: false, reviewSignal: "neutral" } });
    expect(result.gateKey).toBe("vendor_outreach_approval:candidate-1");
    const writes = connection.execute.mock.calls.map(call => String(call[0]))
      .filter(sql => /^\s*(INSERT|UPDATE)/i.test(sql));
    expect(writes.join("\n")).toMatch(/vendor_sourcing_candidate_scores/);
    expect(writes.join("\n")).toMatch(/procurement_operator_gates/);
    expect(writes.join("\n")).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(writes.join("\n")).not.toMatch(/\b(send|message|outreach_template|stripe|payment)\b/i);
  });

  it("does not promote when the operator gate is not approved", async () => {
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ id: "candidate-1", tenant_id: "default",
          source_type: "public_business_directory", sourcing_status: "pending_operator_review",
          source_compliance_snapshot_json: {} }], []])
        .mockResolvedValueOnce([[{ gate_key: outreachGateKey("candidate-1"), status: "pending" }], []]),
    };
    const store = new VendorSourcingScoringStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await expect(store.promoteAfterOperatorApproval({ candidateId: "candidate-1", tenantId: "default" }))
      .rejects.toThrow("operator_gate_not_approved");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(call => /approved_for_outreach/.test(String(call[0])))).toBe(false);
  });
});
