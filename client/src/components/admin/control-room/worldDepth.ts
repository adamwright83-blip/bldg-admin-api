import type { SiegeDepth } from "@shared/canonicalBuilding";

export type ArchitecturalDepth = {
  feature: "horizon" | "callbox" | "street_doors" | "elevator" | "tower_lights" | "closed_gate";
  label: string;
  consequence: string;
};

export function architecturalDepth(depth: SiegeDepth | null): ArchitecturalDepth {
  switch (depth) {
    case "reachable":
      return { feature: "callbox", label: "Callbox live", consequence: "A reachable human opened the first real channel." };
    case "inbound":
    case "at_the_door":
      return { feature: "street_doors", label: depth === "at_the_door" ? "Street doors reached" : "Street doors ahead", consequence: "The approach has moved from planning into the building's real frontage." };
    case "inside":
      return { feature: "elevator", label: "Elevator unlocked", consequence: "A completed visit moved the work beyond the lobby." };
    case "held":
      return { feature: "tower_lights", label: "Tower lights claimed", consequence: "A recorded account win changed the building permanently." };
    case "closed":
      return { feature: "closed_gate", label: "Approach closed", consequence: "This route ended; the building remains real and the result is retained." };
    default:
      return { feature: "horizon", label: "Approach forming", consequence: "The next verified rung is visible without claiming arrival." };
  }
}

export type WorldDayPhase = "morning" | "day" | "settling" | "night";

export function worldDayPhase(hour: number): WorldDayPhase {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 20) return "day";
  if (hour >= 20 && hour < 22) return "settling";
  return "night";
}

