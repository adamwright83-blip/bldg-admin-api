import { describe, expect, it, vi } from "vitest";
import { VendorSourcingStore } from "./vendorSourcingStore";

const MOCK_CANDIDATE_ROW = {
  id: "candidate-1",
  tenant_id: "default",
  building_slug: null,
  source_type: "permitted_public_fetch",
  source_reference: "place_123",
  category: "dog_grooming",
  business_name: "Paw Spa LA",
  sourcing_status: "discovered",
  created_by: "google_places_discovery",
  created_at: new Date("2026-06-24T00:00:00.000Z"),
  updated_at: new Date("2026-06-24T00:00:00.000Z"),
};

const MOCK_CANDIDATE_REVIEW_ROW = {
  ...MOCK_CANDIDATE_ROW,
  public_profile_json: { address: "123 Main St, Los Angeles, CA", coordinates: { lat: 34.1, lng: -118.3 }, sourceUrl: "https://maps.google.com/?cid=1" },
  evidence_json: {
    provider: "google_places", placeId: "place_123", businessName: "Paw Spa LA", rating: 4.9, reviewCount: 220,
    address: "123 Main St, Los Angeles, CA", website: "https://pawspala.example", phone: "(323) 555-0100",
    coordinates: { lat: 34.1, lng: -118.3 }, sourceUrl: "https://maps.google.com/?cid=1",
  },
};

function makePool(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn().mockResolvedValue([rows, []]);
  return { pool: { execute } as never, execute };
}

describe("VendorSourcingStore -- findCandidateBySourceReference", () => {
  it("returns the matching candidate when one exists for this tenant/source/reference", async () => {
    const { pool, execute } = makePool([MOCK_CANDIDATE_ROW]);
    const store = new VendorSourcingStore(pool);
    const result = await store.findCandidateBySourceReference("default", "permitted_public_fetch", "place_123");

    expect(result?.id).toBe("candidate-1");
    expect(result?.sourceReference).toBe("place_123");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = ? AND source_type = ? AND source_reference = ?"),
      ["default", "permitted_public_fetch", "place_123"],
    );
  });

  it("returns null when no candidate matches, rather than fabricating one", async () => {
    const { pool } = makePool([]);
    const store = new VendorSourcingStore(pool);
    const result = await store.findCandidateBySourceReference("default", "permitted_public_fetch", "place_999");
    expect(result).toBeNull();
  });

  it("scopes the lookup to the given tenant -- never cross-tenant", async () => {
    const { pool, execute } = makePool([]);
    const store = new VendorSourcingStore(pool);
    await store.findCandidateBySourceReference("tenant-b", "permitted_public_fetch", "place_123");
    expect(execute).toHaveBeenCalledWith(expect.any(String), ["tenant-b", "permitted_public_fetch", "place_123"]);
  });
});

describe("VendorSourcingStore -- listCandidates (Sub-slice 76b LIMIT hardening)", () => {
  it("works with missing/default input and never passes undefined into execute params", async () => {
    const { pool, execute } = makePool([MOCK_CANDIDATE_ROW]);
    const store = new VendorSourcingStore(pool);

    const candidates = await store.listCandidates({ tenantId: "default" });

    expect(candidates).toHaveLength(1);
    const [sql, params] = execute.mock.calls[0];
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    expect(placeholderCount).toBe(params.length);
    expect(params).toEqual(["default"]);
    expect(params).not.toContain(undefined);
  });

  it("inlines a clamped LIMIT directly into the SQL string -- never binds it as a `?` placeholder", async () => {
    // mysql2's .execute() fails against this MySQL version with
    // "Incorrect arguments to mysqld_stmt_execute" when LIMIT is bound
    // as a parameter -- confirmed by direct reproduction against
    // production MySQL 9.6.0. LIMIT must be inlined, not parameterized.
    const { pool, execute } = makePool([]);
    const store = new VendorSourcingStore(pool);

    await store.listCandidates({ tenantId: "default", limit: 99999 });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toMatch(/LIMIT \?/);
    expect(sql).toMatch(/LIMIT 250\s*$/);
    expect(params).toEqual(["default"]);
  });

  it("includes the status param only when a status filter is provided, with the placeholder count always matching", async () => {
    const { pool, execute } = makePool([]);
    const store = new VendorSourcingStore(pool);

    await store.listCandidates({ tenantId: "default", status: "discovered", limit: 5 });
    const [sql, params] = execute.mock.calls[0];
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    expect(placeholderCount).toBe(params.length);
    expect(params).toEqual(["default", "discovered"]);
  });

  it("never fabricates a candidate -- returns exactly what the store reports", async () => {
    const { pool } = makePool([MOCK_CANDIDATE_ROW]);
    const store = new VendorSourcingStore(pool);
    const candidates = await store.listCandidates({ tenantId: "default" });
    expect(candidates).toEqual([{
      id: "candidate-1", tenantId: "default", buildingSlug: null, sourceType: "permitted_public_fetch",
      sourceReference: "place_123", category: "dog_grooming", businessName: "Paw Spa LA",
      sourcingStatus: "discovered", createdBy: "google_places_discovery",
      createdAt: MOCK_CANDIDATE_ROW.created_at, updatedAt: MOCK_CANDIDATE_ROW.updated_at,
    }]);
  });
});

describe("VendorSourcingStore -- listCandidatesForReview (Sub-slice 76c)", () => {
  function makeReviewPool(rows: Array<Record<string, unknown>> = []) {
    const execute = vi.fn().mockResolvedValue([rows, []]);
    return { pool: { execute } as never, execute };
  }

  it("works with missing/default input and never passes undefined into execute params", async () => {
    const { pool, execute } = makeReviewPool([MOCK_CANDIDATE_REVIEW_ROW]);
    const store = new VendorSourcingStore(pool);

    const candidates = await store.listCandidatesForReview({ tenantId: "default" });

    expect(candidates).toHaveLength(1);
    const [sql, params] = execute.mock.calls[0];
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    expect(placeholderCount).toBe(params.length);
    expect(params).toEqual(["default"]);
    expect(params).not.toContain(undefined);
  });

  it("includes evidence and public profile so the UI can show rating/review count/address/phone/website without inventing anything", async () => {
    const { pool } = makeReviewPool([MOCK_CANDIDATE_REVIEW_ROW]);
    const store = new VendorSourcingStore(pool);

    const [candidate] = await store.listCandidatesForReview({ tenantId: "default" });
    expect(candidate.evidence).toMatchObject({ rating: 4.9, reviewCount: 220, website: "https://pawspala.example", phone: "(323) 555-0100" });
    expect(candidate.publicProfile).toMatchObject({ address: "123 Main St, Los Angeles, CA" });
  });

  it("filters by category (not mission id -- no mission_id column exists), with placeholder count matching params", async () => {
    const { pool, execute } = makeReviewPool([]);
    const store = new VendorSourcingStore(pool);

    await store.listCandidatesForReview({ tenantId: "default", category: "dog_grooming", limit: 5 });
    const [sql, params] = execute.mock.calls[0];
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    expect(placeholderCount).toBe(params.length);
    expect(params).toEqual(["default", "dog_grooming"]);
  });

  it("inlines a clamped LIMIT directly into the SQL string -- never binds it as a `?` placeholder", async () => {
    const { pool, execute } = makeReviewPool([]);
    const store = new VendorSourcingStore(pool);

    await store.listCandidatesForReview({ tenantId: "default", limit: 99999 });
    const [sql] = execute.mock.calls[0];
    expect(sql).not.toMatch(/LIMIT \?/);
    expect(sql).toMatch(/LIMIT 250\s*$/);
  });

  it("returns an empty array honestly when no candidates exist, rather than fabricating one", async () => {
    const { pool } = makeReviewPool([]);
    const store = new VendorSourcingStore(pool);
    const candidates = await store.listCandidatesForReview({ tenantId: "default" });
    expect(candidates).toEqual([]);
  });
});
