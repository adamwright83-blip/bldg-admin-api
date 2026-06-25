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
