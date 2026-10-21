import { beforeAll, describe, expect, it } from "vitest";
import { listReunionEvents, recordReunionEvent } from "./reunionQuestEvents";

describe("Silver Lake reunion events store (no database: test fallback)", () => {
  beforeAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("records append-only events for the selected business only", async () => {
    await recordReunionEvent({ tenantId: "laundry_farm", territoryId: "silver-lake", operatorId: "adam-admin", customerId: "c1", templateId: "cat_hose_flute", kind: "item_found" });
    await recordReunionEvent({ tenantId: "laundry_farm", territoryId: "silver-lake", operatorId: "adam-admin", customerId: "c1", templateId: "cat_hose_flute", kind: "passed" });
    await recordReunionEvent({ tenantId: "default", territoryId: "silver-lake", operatorId: "adam-admin", customerId: "c2", templateId: "bunny_kite", kind: "passed" });
    const events = await listReunionEvents({ tenantId: "laundry_farm", territoryId: "silver-lake" });
    expect(events.map(e => [e.customerId, e.kind])).toEqual([
      ["c1", "item_found"],
      ["c1", "passed"],
    ]);
  });

  it("refuses an unknown template or a missing customer", async () => {
    const base = { tenantId: "laundry_farm", territoryId: "silver-lake", operatorId: "adam-admin", kind: "passed" as const };
    await expect(recordReunionEvent({ ...base, customerId: "c1", templateId: "Drop Table" })).rejects.toThrow(/template/);
    await expect(recordReunionEvent({ ...base, customerId: "  ", templateId: "cat_hose_flute" })).rejects.toThrow(/customer/);
  });
});
