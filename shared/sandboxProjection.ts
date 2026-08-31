import { settleTowerWars, type TowerWarsSettlement } from "./towerWarsSettlement";
import type { TowerWarsBusinessEvent } from "./towerWars";

/** Sandbox presentation projection; delegates entirely to production settlement. */
export function projectSandboxSettlement(input: {
  events: readonly TowerWarsBusinessEvent[];
  todayBusinessDate: string;
  cursor: number;
}): TowerWarsSettlement {
  return settleTowerWars({
    events: input.events.slice(0, Math.max(0, input.cursor)),
    todayBusinessDate: input.todayBusinessDate,
  });
}
