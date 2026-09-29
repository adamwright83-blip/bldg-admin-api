/**
 * Laundry / Fluff-and-Fold Vertical Template (Slice 6)
 * Implements trade-specific logic for wash-and-fold delivery operators.
 */

import type { VerticalTemplate } from "./types";

const legacyStrategy = {
  funnelStages: [
    "Property Discovery",
    "Property Approval",
    "Door Tag Launch",
    "Resident First Order",
    "Resident Repeat Order",
  ],
  stallReasons: [
    "timing",
    "price",
    "trust",
    "pickup_convenience",
    "existing_provider",
    "access_restriction",
    "service_issue",
    "unknown",
  ],
  playTemplates: [
    {
      templateKey: "property_expansion",
      businessName: "Commercial Property Access Outreach",
      worldName: "The Gatekeeper Bastions",
      hypothesis: "In-person property manager walk-ins secure resident access in multi-family buildings.",
      primaryMetric: "new_paying_customers",
      geography: "downtown",
      baseStops: 4,
      isClustered: true,
      estimatedInitiationCost: 65,
      defaultEstimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 6,
        volumeUnit: "property_visits",
      },
    },
    {
      templateKey: "property_activation",
      businessName: "Approved Building Resident Activation",
      worldName: "Rekindling the Great Halls",
      hypothesis: "Lobby displays, resident QR kits, and welcome cards convert building access into resident first orders.",
      primaryMetric: "new_paying_customers",
      geography: "century-city",
      baseStops: 2,
      isClustered: true,
      estimatedInitiationCost: 45,
      defaultEstimatedSpendCents: 2500, // $25 for collateral
      spendCategory: "print_order",
      confidence: "high",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 2,
        volumeUnit: "building_activations",
      },
    },
    {
      templateKey: "door_tag_acquisition",
      businessName: "Residential Door Tag Route Sweep",
      worldName: "The Threshold Route",
      hypothesis: "Physical door hangers with introductory QR discount codes drive neighborhood route density.",
      primaryMetric: "new_paying_customers",
      geography: "wilshire-corridor",
      baseStops: 6,
      isClustered: true,
      estimatedInitiationCost: 70,
      defaultEstimatedSpendCents: 4500, // $45 print orders
      spendCategory: "print_order",
      confidence: "medium",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 100,
        volumeUnit: "tags_deployed",
      },
    },
    {
      templateKey: "dormant_recovery",
      businessName: "Dormant Customer Win-Back Outreach",
      worldName: "The Ember Campaign",
      hypothesis: "Direct check-ins to customers inactive 30+ days recover order volume without acquisition cost.",
      primaryMetric: "active_customers",
      geography: "all_territories",
      baseStops: 1,
      isClustered: false,
      estimatedInitiationCost: 30,
      defaultEstimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 20,
        volumeUnit: "contacts_made",
      },
    },
    {
      templateKey: "first_to_second_order",
      businessName: "First-Order Delivery Service Follow-Up",
      worldName: "Forging the Strong Line",
      hypothesis: "Checking in within 48 hours of first order delivery resolves service concerns and locks in repeat habits.",
      primaryMetric: "active_customers",
      geography: "recent_routes",
      baseStops: 2,
      isClustered: true,
      estimatedInitiationCost: 35,
      defaultEstimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 10,
        volumeUnit: "follow_ups",
      },
    },
    {
      templateKey: "paid_digital_acquisition",
      businessName: "Targeted Corridor Digital Ads",
      worldName: "The Sky Signal",
      hypothesis: "Hyper-local geo-targeted ads increase branded search and website booking flow.",
      primaryMetric: "new_paying_customers",
      geography: "west-hollywood",
      baseStops: 1,
      isClustered: false,
      estimatedInitiationCost: 40,
      defaultEstimatedSpendCents: 15000, // $150 ad spend
      spendCategory: "paid_ads",
      confidence: "low",
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: 100,
        volumeUnit: "ad_clicks",
      },
    },
  ],
} as const;

export const laundryFluffFoldTemplate: VerticalTemplate = {
  verticalKey: "laundry_fluff_fold",
  displayName: "Wash & Fold Residential Service",
  metricCatalog: [
    { metricKey: "new_paying_customers", authoritativeReaderId: "strategy.new_paying_customers.v1" },
    { metricKey: "active_customers", authoritativeReaderId: "strategy.active_customers.v1" },
    { metricKey: "paid_orders_per_period", authoritativeReaderId: "strategy.paid_orders_per_period.v1" },
    { metricKey: "net_sales_per_period", authoritativeReaderId: "strategy.net_sales_per_period.v1" },
  ],
  opportunityKinds: ["property_account", "customer_reactivation"],
  campaignSeeds: [],
  obligationKinds: ["dormant_recovery", "sales_follow_up", "data_health"],
  outcomeDefinitions: [
    { outcomeDefinitionId: "paid_order", authoritativeTransitionId: "economic.paid_order.v1" },
    { outcomeDefinitionId: "customer_reactivated", authoritativeTransitionId: "customer.reactivated.v1" },
  ],
  workFamilies: ["property_visit", "manager_outreach", "follow_up", "reactivation"],
  executionIntelligenceDoctrineFamilies: ["sales"],
  expectedSourceCapabilities: ["customers", "orders", "payments"],
  presentationDefaults: {},
  legacyStrategy,
};

/** Compatibility export for the existing StrategyEngine only. */
export const laundryFluffFoldLegacyStrategy = legacyStrategy;
