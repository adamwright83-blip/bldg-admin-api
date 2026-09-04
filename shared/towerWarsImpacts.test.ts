import { expect, it } from "vitest";
import { impactForAttack, repairImpacts, TOWER_FACADE_BOUNDS } from "./towerWarsImpacts";
import type { TowerWarsAttackEvent } from "./towerWars";
const attack = (index: number): TowerWarsAttackEvent => ({ attackId: `order:attack:${index}`, occurredAt: "2026-09-03T07:00:00Z", attackerBuildingId: "century_park_east", defenderBuildingId: "opus_la", weapon: "century_valet_bazooka", triggeringEventId: "order", triggeringOrderId: 1, thresholdCents: 5000, cumulativeValueAtTriggerCents: index * 5000 });
it("keeps fifteen individually addressed impacts deterministic and inside calibrated facade", () => {
  const impacts = Array.from({ length: 15 }, (_, i) => impactForAttack(attack(i)));
  expect(new Set(impacts.map(i => `${i.impactX}:${i.impactY}`)).size).toBe(15);
  expect(JSON.parse(JSON.stringify(impacts))).toEqual(Array.from({ length: 15 }, (_, i) => impactForAttack(attack(i))));
  for (const i of impacts) {
    expect(i.impactX).toBeGreaterThan(TOWER_FACADE_BOUNDS.opus_la.minX + 3);
    expect(i.impactX).toBeLessThan(TOWER_FACADE_BOUNDS.opus_la.maxX - 3);
    expect(i.impactY).toBeGreaterThan(TOWER_FACADE_BOUNDS.opus_la.minY + 3);
    expect(i.impactY).toBeLessThan(TOWER_FACADE_BOUNDS.opus_la.maxY - 3);
  }
});
it("repairs once, oldest eligible first, and removes repair credit when evidence is voided", () => {
  const impacts = [impactForAttack(attack(1)), impactForAttack(attack(2))];
  const evidence = { orderId: "collection", buildingId: "opus_la" as const, collectedAt: "2026-09-04T07:00:00Z", valid: true };
  const repaired = repairImpacts(impacts, [evidence, evidence]);
  expect(repaired.filter(i => i.repairState === "repaired")).toHaveLength(1);
  expect(repairImpacts(repaired, [{ ...evidence, valid: false }]).every(i => i.repairState === "fresh")).toBe(true);
  expect(repairImpacts(impacts, [{ ...evidence, collectedAt: "2026-09-02T07:00:00Z" }])).toEqual(impacts);
});
