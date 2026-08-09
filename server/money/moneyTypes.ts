import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type MoneyProjection = {
  generatedAt: string;
  collectedRevenue: ProvenancedValue<number>;
  realizedRevenue: ProvenancedValue<number>;
  receivables: ProvenancedValue<number>;
  refunds: ProvenancedValue<number>;
  grossRevenue: ProvenancedValue<number>;
  operatingExpenses: ProvenancedValue<number>;
  ownerPay: ProvenancedValue<number>;
  trueNet: ProvenancedValue<number>;
  reserveRequirement: ProvenancedValue<number>;
  expansionCapital: ProvenancedValue<number>;
  expansionCapitalStatus: "READY" | "INSUFFICIENT_DATA";
  trust: { trusted: boolean; warnings: string[]; source: string };
  dataQuality: DataQuality;
};

export type MoneyScenario = {
  scenarioType: "first_hire" | "second_vehicle" | "equipment" | "territory" | "campaign" | "custom";
  requiredCash: ProvenancedValue<number>;
  reserveAfterAction: ProvenancedValue<number>;
  recurringCostMonthly: ProvenancedValue<number>;
  capacityChange: ProvenancedValue<number>;
  expectedRevenueRange: ProvenancedValue<{ lowCents: number; highCents: number }>;
  breakEvenMonths: ProvenancedValue<{ low: number; high: number }>;
  assumptions: string[];
  missingInformation: string[];
};
