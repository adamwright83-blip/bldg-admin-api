import { expect, it } from "vitest";
import { towerProofFrame, towerProofGeometry } from "./towerPixiProof";
import type { TowerImpact } from "./towerWarsImpacts";
it("registers both battlefield sides to the same persisted facade coordinate", () => {
  const impact = { impactX: 30, impactY: 40 } as TowerImpact;
  expect(towerProofGeometry(impact, true).target).toEqual({ x: 660, y: 270 });
  expect(towerProofGeometry(impact, false).target).toEqual({ x: 180, y: 270 });
  expect(towerProofGeometry(impact, true).direction).toBe(1);
  expect(towerProofGeometry(impact, false).direction).toBe(-1);
});
it("punctuates impact with 80ms hitstop and preserves the wound after completion", () => {
  expect(towerProofFrame(1499).impacted).toBe(false);
  expect(towerProofFrame(1500).hitstop).toBe(true);
  expect(towerProofFrame(1579).hitstop).toBe(true);
  expect(towerProofFrame(1580).hitstop).toBe(false);
  expect(towerProofFrame(5000)).toMatchObject({ complete: true, impacted: true, flight: 1 });
});
