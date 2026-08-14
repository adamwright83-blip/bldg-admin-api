import type { CorridorAction, CorridorBranch } from "../state/GameState";

export type CorridorTrigger = {
  id: string;
  at: number;
  action: CorridorAction;
  label: string;
};

/**
 * Every remaining trigger must have unmistakable, already-visible world
 * geometry backing it — see GoldlineGame.ts's `drawWorld()` for exactly
 * what renders at each trigger's position. The prior fallen-arch (JUMP),
 * white-stone (CLIMB), and water-gap (VAULT) triggers were removed: they
 * were invisible percentage-based gates with no corresponding sprite,
 * manifest landmark, or occlusion geometry anywhere near their positions
 * (confirmed against corridor_01/manifest.json and traversal.json) — a
 * real player correctly could not find any obstacle to jump/climb/vault.
 * fortress-gate survives because it renders a real, always-visible gate
 * (state-colored vector frame plus the stronghold sprite when present;
 * see `this.fortress` drawing in GoldlineGame.ts) that Trailblazer visibly
 * walks up to and INTERACTs with — never a bare percentage check.
 */
export const CORRIDOR_TRIGGERS: CorridorTrigger[] = [
  { id: "fortress-gate", at: 0.79, action: "INTERACT", label: "enter encounter" },
];

export function branchForLateralPosition(x: number): CorridorBranch {
  if (x < -0.34) return "safe";
  if (x > 0.34) return "upper";
  return "intel";
}

export function pendingTrigger(
  progress: number,
  completed: ReadonlySet<string>
): CorridorTrigger | null {
  return (
    CORRIDOR_TRIGGERS.find(
      trigger => !completed.has(trigger.id) && progress >= trigger.at - 0.035
    ) ?? null
  );
}
