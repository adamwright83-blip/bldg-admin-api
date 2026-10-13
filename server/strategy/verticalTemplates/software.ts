import type { VerticalTemplate } from "./types";
/** Declaration only: no laundry metric reader is borrowed for software. */
export const softwareTemplate: VerticalTemplate = {
  verticalKey: "software",
  displayName: "Software",
  metricCatalog: [],
  opportunityKinds: [],
  campaignSeeds: [],
  obligationKinds: ["data_health"],
  outcomeDefinitions: [],
  workFamilies: ["investigation"],
  executionIntelligenceDoctrineFamilies: [],
  expectedSourceCapabilities: ["subscriptions", "product_usage", "billing"],
  presentationDefaults: {},
  strategicIntelligence: {
    version: "2026-10-13.1",
    metrics: [
      "qualified_demand",
      "required_qualified_demand",
      "mature_cohort_customers",
      "mature_cohort_repeat_customers",
      "contribution_per_order_cents",
      "available_capacity",
      "cash_runway_weeks",
    ],
    revenueDrivers: [
      "activation",
      "subscription retention",
      "expansion",
      "pricing",
    ],
    economics: [
      "Separate recurring revenue from hosting, support costs, and contribution",
      "Churn and activation require software cohorts",
    ],
    operatingConstraints: ["support and hosting capacity"],
    customerBehavior: [
      "activation and renewal depend on realized product value",
    ],
    researchRequirements: [
      "buyer alternatives",
      "activation cohorts",
      "subscription billing",
    ],
    limitations: [
      "Software authoritative metric readers are not connected; specialized performance claims are withheld.",
    ],
  },
};
