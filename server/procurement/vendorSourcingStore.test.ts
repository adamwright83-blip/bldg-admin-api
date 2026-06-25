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
