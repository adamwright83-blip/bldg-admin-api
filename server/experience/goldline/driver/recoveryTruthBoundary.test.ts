import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ nodes: [] as unknown[] }));
vi.mock("./driverGameWorldService", () => ({
  listDriverGameWorld: vi.fn(async () => world.nodes),
}));
vi.mock("../../../db", () => ({
  getDb: vi.fn(async () => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: async () => [],
    };
    return { select: () => chain };
  }),
}));
import {
  loadGoldlineProgressionEvidence,
  projectGoldlineProgressionForIdentity,
} from "./progressionProjectionService";

const identity = { tenantId: "tenant-a", actorId: "field-a" };
describe("game recovery intent cannot become verified business recovery", () => {
  beforeEach(() => {
    world.nodes = [];
  });
  it("keeps a persisted/replayed visual recovery unverified and cannot unlock a verified recovery consequence", async () => {
    world.nodes = [
      {
        missionId: 42,
        visualState: "recovery_active",
        resolvedAt: "2026-10-07T00:00:00Z",
      },
    ];
    for (let replay = 0; replay < 2; replay++) {
      const evidence = await loadGoldlineProgressionEvidence(identity);
      expect(evidence.recoveries).toEqual([
        {
          missionId: 42,
          actorId: "field-a",
          state: "recovery_active",
          verifiedAt: null,
          sourceRef: "commercial_missions:42",
        },
      ]);
      const projection = await projectGoldlineProgressionForIdentity(identity);
      expect(
        projection.unlocks.find(
          rule => rule.ruleId === "FIRST_VERIFIED_RECOVERY"
        )
      ).toMatchObject({ eligible: false, evidenceRefs: [] });
      expect(projection.tenantId).toBe("tenant-a");
    }
  });
  it("does not turn an offered recovery path into completed business evidence", async () => {
    world.nodes = [
      { missionId: 43, visualState: "recovery_available", resolvedAt: null },
    ];
    const evidence = await loadGoldlineProgressionEvidence(identity);
    expect(evidence.recoveries[0]?.verifiedAt).toBeNull();
    expect(
      (await projectGoldlineProgressionForIdentity(identity)).unlocks.find(
        rule => rule.ruleId === "FIRST_VERIFIED_RECOVERY"
      )?.eligible
    ).toBe(false);
  });
});
