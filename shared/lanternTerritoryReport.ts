/** Read-only Lantern City territory report. Figures come from the paid-order ledger, not from this file. */

export type LanternReportWindowDays = 30 | 90;

export type LanternReportCustomer = {
  identityKey: string;
  displayName: string;
  phone: string | null;
};

export type LanternTerritoryMetric = {
  id: string;
  name: string;
  revenueCents: number | null;
  previousRevenueCents: number | null;
  revenueChangeCents: number | null;
  paidOrderCount: number | null;
  activeCustomers: number | null;
  dormantCustomers: number | null;
  locatedCustomers: number;
  direction: "up" | "down" | "flat" | "unknown";
  /** True only when both periods are covered well enough to highlight a change. */
  directionReliable: boolean;
  evidenceNote: string;
  customers: LanternReportCustomer[];
};

export type LanternTerritoryReport = {
  tenantId: string;
  /** False on fixture/preview payloads. Live reads are true and still describe their own gaps. */
  figuresAreLive: boolean;
  windowDays: LanternReportWindowDays;
  periodLabel: string;
  comparisonLabel: string | null;
  status: "ready" | "unsupported_geography" | "unavailable";
  reason: string | null;
  geographyBasis: "tenant_location" | "territory_operator_profile" | "none";
  source: {
    bookStatus: "fresh" | "stale" | "partial" | "unavailable" | "unknown";
    completeness: string | null;
    loadedSources: string[];
    failedSources: string[];
    checkedAt: string | null;
    mayStateExact: boolean;
    notes: string[];
  };
  comparison: {
    mostRecordedRevenue: {
      territoryId: string;
      name: string;
      revenueCents: number;
      evidenceClass: string;
    } | null;
    steepestDecline: {
      territoryId: string;
      name: string;
      revenueChangeCents: number;
    } | null;
    dormantOpportunities: {
      territoryId: string;
      name: string;
      dormantCustomers: number;
    }[];
    insufficient: { territoryId: string; name: string; reason: string }[];
    withheldReason: string | null;
  };
  territories: LanternTerritoryMetric[];
  unattributed: { revenueCents: number; orderCount: number };
  ambiguous: { revenueCents: number; orderCount: number };
  outsideService: { revenueCents: number; orderCount: number };
  missingPaymentEvidence: { orderCount: number; cents: number };
  /** Sum of the partitioned current-window cents. Used to match the canonical revenue read. */
  partitionedRevenueCents: number | null;
};
