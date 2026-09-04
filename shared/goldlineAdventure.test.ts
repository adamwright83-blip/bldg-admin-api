import { describe, expect, it } from "vitest";
import { compileGoldlineAdventure, type GoldlineObjective } from "./goldlineAdventure";

const item = (overrides: Partial<GoldlineObjective> & Pick<GoldlineObjective, "id">): GoldlineObjective => ({
  id: overrides.id, physicalEntityId: null, kind: "follow_up", authority: "persisted_task", status: "ready",
  latitude: 34.05, longitude: -118.3, windowStart: null, windowEnd: null, priority: 1,
  explanation: "Persisted follow-up is due", sourceEvidenceReference: `task:${overrides.id}`, ...overrides,
});

describe("compileGoldlineAdventure", () => {
  it("honors fixed commitment windows and excludes completed work", () => {
    const result = compileGoldlineAdventure({ date: "2026-08-31", objectives: [
      item({ id: "late", authority: "fixed_commitment", kind: "delivery", windowStart: "2026-08-31T16:00:00Z" }),
      item({ id: "early", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-08-31T09:00:00Z" }),
      item({ id: "done", status: "completed" }),
    ] });
    expect(result.ordered.map(x => x.id)).toEqual(["early", "late"]);
    expect(result.ordered.some(x => x.id === "done")).toBe(false);
  });
  it("orders flexible objectives geographically without changing their truth", () => {
    const result = compileGoldlineAdventure({ date: "2026-08-31", objectives: [
      item({ id: "anchor", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-08-31T09:00:00Z", latitude: 34, longitude: -118 }),
      item({ id: "far", latitude: 35, longitude: -119, priority: 99 }),
      item({ id: "near", latitude: 34.001, longitude: -118.001 }),
    ] });
    expect(result.ordered.map(x => x.id)).toEqual(["near", "anchor", "far"]);
    expect(result.ordered[0]?.sourceEvidenceReference).toBe("task:near");
  });

  it("bundles legitimate territory members without inventing or dropping commitments", () => {
    const result = compileGoldlineAdventure({
      date: "2026-08-31",
      territoryBundles: [{ territoryId: "t1", memberPhysicalEntityIds: ["p-a", "p-b"] }],
      objectives: [
        item({ id: "delivery", authority: "fixed_commitment", kind: "delivery", windowStart: "2026-08-31T09:00:00Z", latitude: 34, longitude: -118 }),
        item({ id: "visit-b", physicalEntityId: "p-b", latitude: 34.2, longitude: -118.2 }),
        item({ id: "visit-a", physicalEntityId: "p-a", latitude: 34.21, longitude: -118.21 }),
        item({ id: "other", latitude: 34.01, longitude: -118.01 }),
      ],
    });
    expect(result.ordered.map(x => x.id)).toContain("delivery");
    const visitIds = result.ordered.filter(item => item.id.startsWith("visit")).map(item => item.id);
    expect(visitIds.sort()).toEqual(["visit-a", "visit-b"]);
    const firstVisit = result.ordered.findIndex(item => item.id.startsWith("visit"));
    expect(result.ordered[firstVisit + 1]?.id.startsWith("visit")).toBe(true);
    expect(result.chapters.some(chapter => chapter.label === "Territory corridor")).toBe(true);
  });
});
