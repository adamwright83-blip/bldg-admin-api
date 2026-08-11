import type { ArmoryItem } from "../../../../server/armory/armoryTypes";
import type { WorldMissionState } from "../../../../shared/driverGameWorld";

export type AvatarState =
  | "idle"
  | "walk"
  | "run"
  | "jump_start"
  | "jump_air"
  | "land"
  | "climb"
  | "vault"
  | "interact"
  | "encounter_locked";

export type CorridorAction = "JUMP" | "CLIMB" | "VAULT" | "INTERACT";
export type CorridorBranch = "safe" | "intel" | "upper";
export type AbilityFit = "high" | "medium" | "low";

export type EquippedAbility = ArmoryItem & {
  fit: AbilityFit;
  fitReason: string;
};

export type PlayableMission = {
  key: string;
  missionId: number | null;
  moveId: string | null;
  name: string;
  address: string | null;
  navigationUrl: string | null;
  phoneUrl: string | null;
  destinationPath: string | null;
  state: WorldMissionState;
  timeBurdenMinutes: number | null;
  travelBurdenMinutes: number | null;
  estimatedValueLowCents: number | null;
  estimatedValueHighCents: number | null;
  confidence: "high" | "medium" | "low" | "unknown";
  expiresAt: string | null;
  contestedUntil: string | null;
  verifiedAnnualValueCents: number | null;
  realizedRevenueCents: number;
  unlockedPath: string | null;
  lossReason: string | null;
};

export type ArcadeResolution = "hit" | "miss" | "breached" | null;

export type GameView =
  | "explore"
  | "encounter"
  | "awaiting_business_result"
  | "captured"
  | "rekindle"
  | "recovery_active"
  | "closed";
