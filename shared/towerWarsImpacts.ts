import type { TowerWarsAttackEvent, TowerWarsBuildingId } from "./towerWars";
import { formatInTimeZone } from "date-fns-tz";

/** Calibrated facade rectangles in percent of the canonical 800x1200 art.
 * Geometry is fictional; these are not coordinates of real building damage. */
export const TOWER_FACADE_BOUNDS = {
  opus_la: { minX: 13, maxX: 45, minY: 23, maxY: 75 },
  century_park_east: { minX: 20, maxX: 58, minY: 22, maxY: 78 },
};
export type TowerImpact = {
  attackId: string;
  seasonId: string | null;
  attackerBuildingId: TowerWarsBuildingId;
  defenderBuildingId: TowerWarsBuildingId;
  weapon: TowerWarsAttackEvent["weapon"];
  occurredAt: string;
  impactX: number;
  impactY: number;
  impactRegion: "upper" | "middle" | "lower";
  woundType: "fracture" | "cavity" | "scorch" | "chip";
  repairState: "fresh" | "repaired";
  repairedAt: string | null;
  classification: "game_projection";
  provenanceClass: "generated_game_fiction";
};
function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  return (result >>> 0) / 4294967296;
}
export function impactForAttack(attack: TowerWarsAttackEvent, seasonId: string | null = null): TowerImpact {
  const bounds = TOWER_FACADE_BOUNDS[attack.defenderBuildingId];
  const y = hash(`${attack.attackId}:y`);
  return {
    attackId: attack.attackId, seasonId, attackerBuildingId: attack.attackerBuildingId,
    defenderBuildingId: attack.defenderBuildingId, weapon: attack.weapon, occurredAt: attack.occurredAt,
    // Margin contains the complete wound, not only its centre, inside facade.
    impactX: bounds.minX + 4 + hash(`${attack.attackId}:x`) * (bounds.maxX - bounds.minX - 8),
    impactY: bounds.minY + 4 + y * (bounds.maxY - bounds.minY - 8),
    impactRegion: y < 1 / 3 ? "upper" : y < 2 / 3 ? "middle" : "lower",
    woundType: (["fracture", "cavity", "scorch", "chip"] as const)[Math.floor(hash(`${attack.attackId}:wound`) * 4)],
    repairState: "fresh", repairedAt: null,
    classification: "game_projection", provenanceClass: "generated_game_fiction",
  };
}

/** A dated, canonical collection can repair one older impact exactly once.
 * Callers supply authoritative current evidence, excluding voided records.
 * Recompute from scratch so corrected evidence cannot leave a false repair. */
export function repairImpacts(impacts: readonly TowerImpact[], evidence: readonly {
  orderId: string; buildingId: TowerWarsBuildingId; collectedAt: string; valid: boolean;
}[]): TowerImpact[] {
  const result = impacts.map(impact => ({ ...impact, repairState: "fresh" as TowerImpact["repairState"], repairedAt: null as string | null }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.attackId.localeCompare(b.attackId));
  const seen = new Set<string>();
  for (const item of [...evidence].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.orderId.localeCompare(b.orderId))) {
    if (!item.valid || seen.has(item.orderId) || !Number.isFinite(Date.parse(item.collectedAt))) continue;
    seen.add(item.orderId);
    const impact = result.find(i => i.defenderBuildingId === item.buildingId && i.repairState === "fresh" &&
      formatInTimeZone(i.occurredAt, "America/Los_Angeles", "yyyy-MM-dd") < formatInTimeZone(item.collectedAt, "America/Los_Angeles", "yyyy-MM-dd"));
    if (impact) { impact.repairState = "repaired"; impact.repairedAt = item.collectedAt; }
  }
  return result;
}
