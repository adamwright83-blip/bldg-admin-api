import { describe, expect, it, vi } from "vitest";
import { authorizeRetentionRequest } from "./retentionRoute";
import {
  DAYFORGE_RETENTION_MATRIX,
  retentionCutoff,
  type DayforgeRetentionResource,
} from "./retentionPolicy";
import {
  runDayforgeRetention,
  type DayforgeRetentionStore,
} from "./retentionService";

class FakeStore implements DayforgeRetentionStore {
  counts = new Map<DayforgeRetentionResource, number>();
  countEligible = vi.fn(async ({ resource, limit }) =>
    Math.min(limit, this.counts.get(resource) ?? 0)
  );
  purgeEligible = vi.fn(async ({ resource, limit }) => {
    const existing = this.counts.get(resource) ?? 0;
    const purged = Math.min(limit, existing);
    this.counts.set(resource, existing - purged);
    return purged;
  });
}

describe("DayForge retention", () => {
  it("never schedules immutable audit or operational evidence for deletion", () => {
    expect(DAYFORGE_RETENTION_MATRIX).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "operational_audit", automatedAction: "preserve" }),
        expect.objectContaining({ resource: "operational_evidence", automatedAction: "preserve" }),
      ])
    );
  });

  it("dry-runs without writes and respects one global batch ceiling", async () => {
    const store = new FakeStore();
    store.counts.set("anonymous_preview_results", 8);
    store.counts.set("anonymous_preview_sessions", 8);
    const result = await runDayforgeRetention({
      store,
      dryRun: true,
      batchLimit: 10,
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(result.totalEligible).toBe(10);
    expect(result.resources.reduce((sum, row) => sum + row.purged, 0)).toBe(0);
    expect(store.purgeEligible).not.toHaveBeenCalled();
    expect(store.countEligible).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 2 })
    );
  });

  it("is bounded and naturally idempotent across cleanup retries", async () => {
    const store = new FakeStore();
    store.counts.set("product_analytics", 3);
    const first = await runDayforgeRetention({ store, batchLimit: 2 });
    const second = await runDayforgeRetention({ store, batchLimit: 2 });
    const third = await runDayforgeRetention({ store, batchLimit: 2 });
    expect(first.resources.find(row => row.resource === "product_analytics")?.purged).toBe(2);
    expect(second.resources.find(row => row.resource === "product_analytics")?.purged).toBe(1);
    expect(third.totalEligible).toBe(0);
  });

  it("uses the resource policy to derive deterministic cutoffs", () => {
    expect(
      retentionCutoff(
        "anonymous_preview_sessions",
        new Date("2026-07-31T00:00:00.000Z")
      ).toISOString()
    ).toBe("2026-07-30T00:00:00.000Z");
    expect(() =>
      retentionCutoff("game_replays", new Date("2026-07-31T00:00:00.000Z"))
    ).toThrow(/No automated retention policy/);
  });

  it("fails closed when the cleanup secret is absent or wrong", () => {
    expect(authorizeRetentionRequest({}, undefined)).toBe("not_configured");
    expect(
      authorizeRetentionRequest({ authorization: "Bearer wrong" }, "correct")
    ).toBe("forbidden");
    expect(
      authorizeRetentionRequest(
        { "x-dayforge-retention-secret": "correct" },
        "correct"
      )
    ).toBe("authorized");
  });
});
