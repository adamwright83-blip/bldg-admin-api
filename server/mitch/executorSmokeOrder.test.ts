import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMitchProducerPlan } from "./mitchProducerPlans";
import { KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE } from "./executorSmokeOrder";
import { KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING } from "./kingdomTwoProduction";
import { MitchGameDispatcher } from "./mitchDispatcher";
import { MitchProducerCoordinator } from "./mitchProducerCoordinator";
import { MitchQaService } from "./mitchQaService";
import type { GitHubProducerBus } from "./githubProducerBus";
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

  it("does not fall through to duel work or automatically retry a failed one-off smoke", async () => {
    await plan(true).seed();
    const initial = (await store.listWorkOrders(tenantId, gameId)).find(
      o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    )!;
    await store.failWorkOrder({ tenantId, workOrderId: initial.id, error: "executor failed" });

    const nextTick = await plan(true).seed();
    expect(nextTick.workOrder).toBeNull();
    const coordinator = new MitchProducerCoordinator({
      tenantId,
      store,
      service,
      dispatcher: new MitchGameDispatcher(store),
      reasoning: new MitchProductionReasoningService(store),
      qa: new MitchQaService(store),
      bus: {} as GitHubProducerBus,
      gameId,
      gameTitle: "Boreslay",
      seedProductionWork: plan(true).seed,
    });
    expect((await coordinator.runOnce()).action).toBe("idle");
    const all = await store.listWorkOrders(tenantId, gameId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: initial.id, status: "failed" });
  });

  it("does not dispatch a leftover smoke order after smoke mode is switched off", async () => {
    await plan(true).seed();
    const pendingSmoke = (await store.listWorkOrders(tenantId, gameId)).find(
      o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    )!;
    const coordinator = new MitchProducerCoordinator({
      tenantId,
      store,
      service,
      dispatcher: new MitchGameDispatcher(store),
      reasoning: new MitchProductionReasoningService(store),
      qa: new MitchQaService(store),
      bus: {} as GitHubProducerBus,
      smokeOnly: false,
      gameId,
      gameTitle: "Boreslay",
      seedProductionWork: plan(false).seed,
    });
    expect((await coordinator.runOnce()).action).toBe("idle");
    expect((await store.getWorkOrder(tenantId, pendingSmoke.id))?.status).toBe("pending");
  });

  it("does not dispatch an unrelated pending order when the production worker is smoke-only", async () => {
    await plan(true).seed();
    const smokeOrder = (await store.listWorkOrders(tenantId, gameId)).find(
      o => o.milestoneKey === KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE.milestoneKey
    )!;
    await store.failWorkOrder({ tenantId, workOrderId: smokeOrder.id, error: "one-off smoke failed" });
    const oldPending = await service.createWorkOrder({
      tenantId,
      gameId,
      milestoneKey: "k2_install_boreslay_duel_progression",
      title: "Unrelated installation",
      desiredPlayerVisibleResult: "No real business effect",
      acceptanceCriteria: ["A human approves this separately"],
      canonConstraints: ["No auto main merge"],
      relevantDependencies: ["client/src/components/boreslay-rally/RallyDemo.tsx"],
      realBusinessEvidenceConstraints: ["Do not fabricate sales"],
      baseBranch: "main",
      baseSha,
      requiredArtifact: "client/src/components/boreslay-rally/RallyDemo.tsx",
      requiredTests: ["pnpm check"],
    });

    const coordinator = new MitchProducerCoordinator({
      tenantId,
      store,
      service,
      dispatcher: new MitchGameDispatcher(store),
      reasoning: new MitchProductionReasoningService(store),
      qa: new MitchQaService(store),
      bus: {} as GitHubProducerBus,
      smokeOnly: true,
      gameId,
      gameTitle: "Boreslay",
      seedProductionWork: plan(true).seed,
    });
    expect((await coordinator.runOnce()).action).toBe("idle");
    expect((await store.getWorkOrder(tenantId, oldPending.id))?.status).toBe("pending");
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
