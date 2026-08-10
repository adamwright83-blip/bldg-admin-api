import type { ArmoryItem } from "../../../../server/armory/armoryTypes";
import type { EquippedAbility } from "./GameState";

function fitForAnchor(item: ArmoryItem): Pick<EquippedAbility, "fit" | "fitReason"> {
  const text = `${item.title} ${item.cue} ${item.response}`.toLowerCase();
  if (/trial|don't switch|do not switch|switching feels risky/.test(text)) {
    return {
      fit: "high",
      fitReason: "Recommended fit for reducing incumbent-switching risk",
    };
  }
  if (/response time|fast response|already have|current provider/.test(text)) {
    return {
      fit: "medium",
      fitReason: "Relevant to incumbent-provider resistance",
    };
  }
  return {
    fit: "low",
    fitReason: "Available evidence is less specific to this resistance",
  };
}

export function equipAnchorAbilities(items: ArmoryItem[]): EquippedAbility[] {
  return items.slice(0, 3).map(item => ({ ...item, ...fitForAnchor(item) }));
}

export function weakPointSize(fit: EquippedAbility["fit"]): number {
  if (fit === "high") return 96;
  if (fit === "medium") return 76;
  return 58;
}

export function shieldDamage(fit: EquippedAbility["fit"]): number {
  return fit === "high" ? 2 : 1;
}
