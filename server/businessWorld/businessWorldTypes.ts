import type { CustomerAssetSummary } from "../customerAssets/customerAssetTypes";
import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type BusinessStage = "SOLO" | "SUSTAINABLE_SOLO" | "CAPACITY_CONSTRAINED" | "FIRST_HIRE_READY" | "TEAM" | "CREW_CHIEF" | "OPERATOR" | "TYCOON";

export type WorldPoint = {
  id: string;
  kind: "hq" | "customer" | "commercial" | "territory_signal";
  name: string;
  latitude: number | null;
  longitude: number | null;
  geoStatus: "resolved" | "unresolved";
  state: string;
  value: ProvenancedValue<number> | null;
  detailPath: string | null;
  sourceReference: string;
  customerAsset: CustomerAssetSummary | null;
};

export type BusinessWorldProjection = {
  generatedAt: string;
  business: { tenantId: string; name: string; brandName: string; stage: BusinessStage; primaryColor: string };
  hq: WorldPoint;
  properties: WorldPoint[];
  commercialAssets: WorldPoint[];
  territorySignals: WorldPoint[];
  openThreats: Array<{ id: string; type: string; title: string; sourceReference: string; severity: "watch" | "urgent" }>;
  growthSignals: Array<{ id: string; title: string; value: ProvenancedValue<number> | null; sourceReference: string }>;
  financialSummary: {
    collectedRevenue: ProvenancedValue<number>;
    realizedCommercialRevenue: ProvenancedValue<number>;
    receivables: ProvenancedValue<number>;
  };
  capabilities: string[];
  teamSummary: { activeNonOwnerMembers: number; ownerIndependentRevenue: ProvenancedValue<number> };
  recentChanges: Array<{ id: string; occurredAt: string; title: string; sourceReference: string; verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED" }>;
  dataQuality: DataQuality;
};
