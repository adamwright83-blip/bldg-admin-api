import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorReputationEvidenceStore } from "./vendorReputationEvidenceStore";

const baseInput = {
  id: "snapshot-1",
  candidateId: "candidate-1",
  sourceType: "public_business_directory",
  sourceKey: "google_business_profiles",
  rating: 4.7,
  reviewCount: 120,
  sourceConfidence: "trusted" as const,
  sourceApproved: true,
  observedAt: new Date("2026-06-01T00:00:00.000Z"),
  expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  evidencePayload: { businessName: "Acme Dog Grooming" },
  complianceSnapshot: {},
  recordedBy: "operator-1",
  now: new Date("2026-06-19T12:00:00.000Z"),
};

function makeConnection() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    execute: vi.fn()
      .mockResolvedValueOnce([[{ id: "candidate-1" }], []])
      .mockResolvedValueOnce([[{ source_type: "public_business_directory" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
  };
}

describe("vendor reputation evidence store", () => {
  it("writes only vendor_reputation_evidence_snapshots and persists a usable status for valid evidence", async () => {
    const connection = makeConnection();
    const store = new VendorReputationEvidenceStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const result = await store.createSnapshot(baseInput);
    expect(result.evidenceStatus).toBe("usable");
    const writes = connection.execute.mock.calls.map(call => String(call[0]))
      .filter(sql => /^\s*(INSERT|UPDATE)/i.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/vendor_reputation_evidence_snapshots/);
    expect(writes.join("\n")).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(writes.join("\n")).not.toMatch(/\b(outreach|payment|dispatch|stripe)\b/i);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("defaults an unapproved source to a non-usable persisted status instead of trusting the caller", async () => {
    const connection = makeConnection();
    const store = new VendorReputationEvidenceStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const result = await store.createSnapshot({ ...baseInput, sourceApproved: false });
    expect(result.evidenceStatus).not.toBe("usable");
    expect(result.evidenceStatus).toBe("recorded");
  });

  it("rolls back and never inserts when the candidate is not found", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn().mockResolvedValueOnce([[], []]),
    };
    const store = new VendorReputationEvidenceStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await expect(store.createSnapshot(baseInput)).rejects.toThrow("Vendor sourcing candidate not found");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("vendor reputation evidence migration isolation", () => {
  it("migration adds only the evidence snapshot table with safe foreign keys", () => {
    const sql = fs.readFileSync("procurement/migrations/0012_vendor_reputation_evidence.sql", "utf8");
    expect(sql).toContain("vendor_reputation_evidence_snapshots");
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
    expect(sql).not.toMatch(/review_text|raw_review_text|review_body/i);
    expect(sql).not.toMatch(/payment_authorization_id|capture_id|dispatch_request_id|outreach_draft_id/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/race|ethnicity|gender|religion|disability|protected_class/i);
  });
});
