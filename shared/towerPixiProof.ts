import type { TowerImpact } from "./towerWarsImpacts";

/** The same unmirrored 800×1200 facade registration as the DOM renderer. */
export function towerProofGeometry(impact: TowerImpact, attackerOnLeft: boolean) {
  const attackerX = attackerOnLeft ? 60 : 540;
  const defenderX = attackerOnLeft ? 540 : 60;
  return {
    attackerX, defenderX, direction: attackerOnLeft ? 1 : -1,
    launch: { x: attackerX + (attackerOnLeft ? 690 : 800 - 690) * .5, y: 30 + 60 * .5 },
    target: { x: defenderX + impact.impactX * 4, y: 30 + impact.impactY * 6 },
  };
}

export function towerProofFrame(elapsed: number) {
  const flight = Math.max(0, Math.min(1, (elapsed - 600) / 900));
  return { windup: Math.min(1, elapsed / 600), flight,
    hitstop: elapsed >= 1500 && elapsed < 1580,
    impacted: elapsed >= 1500,
    aftermath: Math.max(0, (elapsed - 1580) / 1000), complete: elapsed >= 3000 };
}
