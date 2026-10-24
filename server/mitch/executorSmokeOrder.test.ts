import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMitchProducerPlan } from "./mitchProducerPlans";
import { KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE } from "./executorSmokeOrder";
import { KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING } from "./kingdomTwoProduction";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: vi.fn(async () => null),
}));

describe("Mitch executor smoke order", () => {
  const tenantId = "tenant-smoke";
  const gameId = "kingdom.boreslay";
  const baseSha = "b".repeat(40);
  let store: MitchProductionStore;
  let service: MitchProductionService;

  const plan = (executorSmokeOrder: boolean, sha: string = baseSha) =>
    createMitchProducerPlan({ gameId, tenantId, store, service, baseSha: sha, executorSmokeOrder });

  beforeEach(() => {
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);
  });

  it("creates nothing when the flag is off", async () => {
    await plan(false).seed();
    const milestones = await store.listMilestones(tenantId, gameId);
    expect(milestones.some(m => m.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey)).toBe(false);
  });

  it("creates exactly one order on its own milestone, once, even across ticks", async () => {
    await plan(true).seed();
    await plan(true).seed();
    await plan(true).seed();

    const orders = await store.listWorkOrders(tenantId, gameId);
    const smoke = orders.filter(o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey);
    expect(smoke).toHaveLength(1);
    expect(smoke[0].status).toBe("pending");
    expect(smoke[0].requiredArtifact).toBe("client/src/components/boreslay-rally/rallyScoring.test.ts");
  });

  it("serializes simultaneous producer ticks into exactly one smoke order and milestone", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => plan(true).seed())
    );
    const milestones = (await store.listMilestones(tenantId, gameId)).filter(
      m => m.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    );
    const smokeOrders = (await store.listWorkOrders(tenantId, gameId)).filter(
      o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    );
    expect(milestones).toHaveLength(1);
    expect(smokeOrders).toHaveLength(1);
    expect(smokeOrders[0].milestoneId).toBe(milestones[0].id);
    expect(results.filter(r => r.workOrder?.id === smokeOrders[0].id)).toHaveLength(1);
    expect(smokeOrders[0].status).toBe("pending");
  });

  it("does not recreate the order after it has failed", async () => {
    await plan(true).seed();
    const [order] = await store.listWorkOrders(tenantId, gameId);
    await store.failWorkOrder({ tenantId, workOrderId: order.id, error: "boom" });
    await plan(true).seed();
    const smoke = (await store.listWorkOrders(tenantId, gameId)).filter(
      o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    );
    expect(smoke).toHaveLength(1);
  });

  it("never unblocks or creates work for the human-blocked business binding milestone", async () => {
    await plan(true).seed();
    const binding = await store.getMilestone(tenantId, gameId, KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING.milestoneKey);
    expect(binding?.status).toBe("blocked");
    expect(binding?.isHumanCreativeBlocker).toBe(true);
    const orders = await store.listWorkOrders(tenantId, gameId);
    expect(orders.some(o => o.milestoneKey === KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING.milestoneKey)).toBe(false);
  });

  it("makes the smoke milestone the next dispatch target", async () => {
    await plan(true).seed();
    const inspection = await new MitchProductionReasoningService(store).inspectProductionState(tenantId, gameId);
    expect(inspection.incompleteMilestone?.milestoneKey).toBe(KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey);
  });

  it("requires an exact 40-char base sha", async () => {
    await expect(plan(true, "").seed()).rejects.toThrow(/40-character/);
  });
});
