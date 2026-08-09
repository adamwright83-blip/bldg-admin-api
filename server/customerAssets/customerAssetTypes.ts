import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type CustomerAssetKind = "residential" | "commercial";
export type CustomerHealth = "healthy" | "watch" | "at_risk" | "unknown";

export type CustomerAssetTimelineItem = {
  id: string;
  occurredAt: string;
  type: "order" | "payment" | "commercial_stage" | "follow_up" | "recovery";
  title: string;
  sourceReference: string;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED";
  amountCents: number | null;
};

export type CustomerAsset = {
  id: string;
  kind: CustomerAssetKind;
  displayName: string;
  identityKey: string;
  property: {
    address: string | null;
    unit: string | null;
    buildingSlug: string | null;
    latitude: string | null;
    longitude: string | null;
    geoStatus: "resolved" | "unresolved";
  };
  contact: { phone: string | null; email: string | null };
  service: {
    orderCount: number;
    completedCount: number;
    lastServiceAt: string | null;
    recurring: boolean;
    serviceTypes: string[];
  };
  lifetimeValue: ProvenancedValue<number>;
  outstandingReceivables: ProvenancedValue<number>;
  averageOrderValue: ProvenancedValue<number>;
  health: CustomerHealth;
  healthReason: string;
  recovery: { status: string | null; interventionId: string | null };
  commercial: {
    accountId: number | null;
    stage: string | null;
    estimatedAnnualValue: ProvenancedValue<number>;
    approvedValue: ProvenancedValue<number>;
    realizedRevenue: ProvenancedValue<number>;
  } | null;
  nextAction: { label: string; path: string } | null;
  timeline: CustomerAssetTimelineItem[];
  dataQuality: DataQuality;
};

export type CustomerAssetSummary = Omit<CustomerAsset, "timeline">;
