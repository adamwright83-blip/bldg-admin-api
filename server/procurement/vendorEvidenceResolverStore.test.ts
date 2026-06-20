import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorEvidenceResolverStore } from "./vendorEvidenceResolverStore";

const dbRow = {
  id: "snapshot-1",
  candidate_id: "candidate-1",
  source_type: "public_business_directory",
  source_key: "google_business_profiles",
  evidence_status: "usable",
  rating: "4.70",
  rating_scale_min: "0.00",
  rating_scale_max: "5.00",
  review_count: 120,
  source_confidence: "trusted",
  source_approved: 1,
  observed_at: new Date("2026-06-01T00:00:00.000Z"),
  expires_at: new Date("2026-07-01T00:00:00.000Z"),
  evidence_payload_json: JSON.stringify({ businessName: "Acme Dog Grooming" }),
  compliance_snapshot_json: JSON.stringify({}),
};

describe("vendor evidence resolver store", () => {
  it("only issues a SELECT against vendor_reputation_evidence_snapshots and maps rows", async () => {
    const query = vi.fn().mockResolvedValueOnce([[dbRow], []]);
    const store = new VendorEvidenceResolverStore({ query } as never);
    const rows = await store.listEvidenceRowsForCandidates(["candidate-1"]);

    expect(query).toHaveBeenCalledOnce();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/^\s*SELECT/i);
    expect(sql).toMatch(/vendor_reputation_evidence_snapshots/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);

    expect(rows).toEqual([{
      id: "snapshot-1",
      candidateId: "candidate-1",
      sourceType: "public_business_directory",
      sourceKey: "google_business_profiles",
      evidenceStatus: "usable",
      rating: 4.7,
      ratingScaleMin: 0,
      ratingScaleMax: 5,
      reviewCount: 120,
      sourceConfidence: "trusted",
      sourceApproved: true,
      observedAt: dbRow.observed_at,
      expiresAt: dbRow.expires_at,
      evidencePayload: { businessName: "Acme Dog Grooming" },
      complianceSnapshot: {},
    }]);
  });

  it("never queries the database for an empty candidate list", async () => {
    const query = vi.fn();
    const store = new VendorEvidenceResolverStore({ query } as never);
    const rows = await store.listEvidenceRowsForCandidates([]);
    expect(rows).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("vendor evidence resolver store source isolation", () => {
  it("contains no write statements or legacy/connector table references", () => {
    const sql = fs.readFileSync("server/procurement/vendorEvidenceResolverStore.ts", "utf8");
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE\s+\w|DELETE FROM)\b/i);
    expect(sql).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(sql).not.toMatch(/\bfetch\(/);
  });
});
