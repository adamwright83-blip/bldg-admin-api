import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  VENDOR_SOURCE_TYPES,
  canCreateCandidate,
  isCandidateReadyForOutreach,
  sourceAllowsCandidateDiscovery,
  sourceAllowsPublicEvidenceCapture,
  sourceProhibitsUnsafeAccess,
  type VendorSourceRegistryRow,
} from "./vendorSourcingPolicy";
import { VendorSourcingStore } from "./vendorSourcingStore";

const registry = (patch: Partial<VendorSourceRegistryRow> = {}): VendorSourceRegistryRow => ({
  sourceType: "public_business_directory",
  complianceClass: "public_directory",
  allowedUseFlags: { candidate_discovery: true, public_evidence_capture: true },
  prohibitedUseFlags: {
    login_bypass: true,
    tos_violating_access: true,
    hidden_bulk_scraping: true,
    purchased_lead_lists: true,
  },
  sourcePolicy: { publicly_accessible_only: true, automated_fetch_allowed: false },
  notes: null,
  ...patch,
});

const candidate = { sourceType: "public_business_directory", sourceReference: "directory:123",
  category: "flowers", businessName: "Flowers LLC" };

describe("vendor sourcing compliance policy", () => {
  it("defines exactly the approved Slice 10 source types", () => {
    expect(VENDOR_SOURCE_TYPES).toEqual([
      "manual_operator_list", "public_business_directory", "permitted_public_fetch",
    ]);
  });

  it("fails closed for unknown or incomplete source policy", () => {
    expect(sourceAllowsCandidateDiscovery(null)).toBe(false);
    expect(sourceAllowsCandidateDiscovery(registry({ sourceType: "unknown_source" }))).toBe(false);
    expect(sourceAllowsCandidateDiscovery(registry({ prohibitedUseFlags: {} }))).toBe(false);
  });

  it("allows only intended discovery and public-evidence uses", () => {
    expect(sourceAllowsCandidateDiscovery(registry())).toBe(true);
    expect(sourceAllowsPublicEvidenceCapture(registry())).toBe(true);
    expect(sourceAllowsPublicEvidenceCapture(registry({
      sourceType: "manual_operator_list",
      allowedUseFlags: { candidate_discovery: true, public_evidence_capture: false },
    }))).toBe(false);
  });

  it("requires every unsafe access mode to be prohibited", () => {
    expect(sourceProhibitsUnsafeAccess(registry())).toBe(true);
    for (const key of ["login_bypass", "tos_violating_access", "hidden_bulk_scraping", "purchased_lead_lists"]) {
      expect(sourceProhibitsUnsafeAccess(registry({
        prohibitedUseFlags: { ...registry().prohibitedUseFlags, [key]: false },
      }))).toBe(false);
    }
  });

  it("requires candidate identity and a matching registered source", () => {
    expect(canCreateCandidate(candidate, registry()).allowed).toBe(true);
    expect(canCreateCandidate({ ...candidate, businessName: "" }, registry()).allowed).toBe(false);
    expect(canCreateCandidate(candidate, null).reasons).toContain("source_not_registered");
    expect(canCreateCandidate(candidate, registry({ sourceType: "manual_operator_list" })).reasons)
      .toContain("source_registry_mismatch");
  });

  it("never declares a Slice 10 candidate outreach-ready", () => {
    expect(isCandidateReadyForOutreach()).toBe(false);
  });
});

describe("vendor sourcing migration and store isolation", () => {
  it("seeds compliant source names without a scrape source type", () => {
    const sql = fs.readFileSync("procurement/migrations/0006_vendor_sourcing_foundation.sql", "utf8");
    for (const sourceType of VENDOR_SOURCE_TYPES) expect(sql).toContain(`'${sourceType}'`);
    expect(sql).not.toContain("'public_website_scrape'");
    expect(sql).not.toMatch(/['"]scrape['"]/);
    expect(sql).toContain("'hidden_bulk_scraping'");
    expect(sql).toContain("'purchased_lead_lists'");
    expect(sql).not.toMatch(/`vendor_id`/i);
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
  });

  it("writes only the new candidate table and snapshots compliance", async () => {
    const dbRow = {
      source_type: "public_business_directory", compliance_class: "public_directory",
      allowed_use_flags_json: { candidate_discovery: true, public_evidence_capture: true },
      prohibited_use_flags_json: registry().prohibitedUseFlags,
      source_policy_json: registry().sourcePolicy, notes: null,
    };
    const connection = {
      beginTransaction: vi.fn(), execute: vi.fn()
        .mockResolvedValueOnce([[dbRow], []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]),
      commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    };
    const store = new VendorSourcingStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createCandidate({ id: "candidate-1", tenantId: "default", ...candidate,
      evidence: { profile: "public" }, createdBy: "operator-1" });
    expect(connection.commit).toHaveBeenCalledOnce();
    const statements = connection.execute.mock.calls.map(call => String(call[0]));
    expect(statements.some(sql => /INSERT INTO vendor_sourcing_candidates/.test(sql))).toBe(true);
    expect(statements.join("\n")).not.toMatch(/INSERT\s+INTO\s+(vendors|vendorProfiles|vendorServices)\b/i);
    expect(statements.join("\n")).not.toMatch(/\b(fetch|send|outreach|stripe|payment)\b/i);
    const insertParams = connection.execute.mock.calls[1]?.[1] as unknown[];
    expect(String(insertParams[11])).toContain("hidden_bulk_scraping");
  });
});
