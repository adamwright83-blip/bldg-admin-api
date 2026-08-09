import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type GrowMoveType = "recover_customer" | "follow_up_commercial_account" | "visit_nearby_prospect" | "call_prospect";

export type GrowMove = {
  id: string;
  moveType: GrowMoveType;
  title: string;
  source: { type: string; id: string; reference: string };
  expectedTimeMinutes: number;
  cashCost: ProvenancedValue<number>;
  capacityCost: ProvenancedValue<number>;
  expectedValue: ProvenancedValue<{ lowCents: number; highCents: number }>;
  confidence: "high" | "medium" | "low" | "unknown";
  evidence: string[];
  expiresAt: string | null;
  whyNow: string;
  destinationPath: string;
};

export type GrowProjection = {
  generatedAt: string;
  moves: GrowMove[];
  scarcity: {
    ownerTimeMinutes: ProvenancedValue<number>;
    growthSpendCents: ProvenancedValue<number>;
    openCapacityUnits: ProvenancedValue<number>;
    capacityFull: boolean;
  };
  dataQuality: DataQuality;
};
