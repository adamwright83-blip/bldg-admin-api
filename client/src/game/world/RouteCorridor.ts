import type { CorridorAction, CorridorBranch } from "../state/GameState";

export type CorridorTrigger = {
  id: string;
  at: number;
  action: CorridorAction;
  label: string;
};

export const CORRIDOR_TRIGGERS: CorridorTrigger[] = [
  { id: "fallen-arch", at: 0.24, action: "JUMP", label: "over fallen arch" },
  { id: "white-stone", at: 0.43, action: "CLIMB", label: "white-stone wall" },
  { id: "water-gap", at: 0.61, action: "VAULT", label: "waterfall gap" },
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
