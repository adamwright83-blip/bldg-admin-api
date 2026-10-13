import type {
  BusinessDriver,
  StrategyEvidence,
} from "../../shared/strategicIntelligence";
import {
  assembleStrategicDiagnosis,
  type DiagnosisInput,
} from "./strategicDiagnosis";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import { rankMissionDirectorWork } from "../planning/missionDirector/rankableWork";
import { diagnosisCandidates } from "./strategicCandidateAdapter";

export type StrategicScenario = {
  id: string;
  facts: string[];
  missing: string[];
  availableActions: string[];
  input: DiagnosisInput;
  expectedDriver: BusinessDriver;
  reasoningProperties: string[];
  disqualifyingErrors: string[];
};
const NOW = new Date("2026-10-13T16:00:00Z");
function makeInput(
  values: Record<string, number>,
  location: "la" | "iowa" = "la",
  verticalKey = "laundry_fluff_fold"
): DiagnosisInput {
  const evidence: StrategyEvidence[] = [
    {
      id: "goal:1",
      tenantId: "scenario",
      source: "operator_goal",
      capturedAt: NOW.toISOString(),
      classification: "operator_input",
      value: "Improve profitable revenue",
      unit: "goal",
      quality: "complete",
      description: "Declared goal",
    },
  ];
  const metrics: DiagnosisInput["metrics"] = {};
  for (const [key, value] of Object.entries(values)) {
    metrics[key] = `metric:${key}`;
    evidence.push({
      id: metrics[key]!,
      tenantId: "scenario",
      source: "controlled_fixture_authoritative_reader",
      capturedAt: NOW.toISOString(),
      classification: "verified",
      value,
      unit: key,
      quality: "complete",
      description: key,
    });
  }
  return {
    tenantId: "scenario",
    canonicalOperatorId: "scenario:operator",
    verticalKey,
    businessDate: "2026-10-13",
    now: NOW,
    goal: {
      statement: "Improve profitable revenue",
      metricKey: "net_sales_per_period",
      target: 20000,
      current: 10000,
      evidenceRef: "goal:1",
    },
    evidence,
    metrics,
    market: {
      tenantId: "scenario",
      mode: verticalKey === "software" ? "online" : "physical",
      territories:
        verticalKey === "software"
          ? []
          : [
              {
                id: `location:${location}`,
                label:
                  location === "la"
                    ? "Los Angeles operating market"
                    : "Des Moines operating market",
                address:
                  location === "la" ? "Los Angeles, CA" : "Des Moines, IA",
                latitude: location === "la" ? 34.05 : 41.59,
                longitude: location === "la" ? -118.25 : -93.62,
                radiusMiles: 5,
                sourceRef: `tenant_location:${location}`,
                capturedAt: NOW.toISOString(),
              },
            ],
      observations: [],
      limitations: ["No provider market research in this controlled case"],
    },
    outcomes: [],
    commitments: [],
  };
}
function scenario(
  id: string,
  input: DiagnosisInput,
  expectedDriver: BusinessDriver,
  facts: string[],
  missing: string[] = []
): StrategicScenario {
  return {
    id,
    input,
    expectedDriver,
    facts,
    missing,
    availableActions: [
      "Bounded source-record audit",
      "Qualified-segment preparation",
      "Existing acquisition task",
    ],
    reasoningProperties: [
      "Explain a plausible constraint",
      "Compare alternatives",
      "Keep economics and unknowns explicit",
      "Only cite supplied evidence",
      "Preserve execution approval",
    ],
    disqualifyingErrors: [
      "Invented geography",
      "Fabricated ROI or causal proof",
      "Industry leakage",
      "Task completion treated as business result",
      "Unapproved execution",
    ],
  };
}
const strong = {
  mature_cohort_customers: 100,
  mature_cohort_repeat_customers: 80,
  qualified_demand: 10,
  required_qualified_demand: 40,
};
const weak = {
  mature_cohort_customers: 100,
  mature_cohort_repeat_customers: 10,
};
const sparse = makeInput({});
const stale = makeInput({ contribution_per_order_cents: -500, ...weak });
stale.evidence.slice(1).forEach(e => {
  e.quality = "stale";
});
const contradiction = makeInput(weak);
contradiction.evidence.push({
  id: "verified-result",
  tenantId: "scenario",
  source: "goal_cycle_outcomes:controlled",
  capturedAt: NOW.toISOString(),
  classification: "verified",
  value:
    "Reactivation produced no paid repeat purchases in the predeclared observation window",
  unit: "result",
  quality: "complete",
  description: "Observed disappointing result; completion is separate",
});
contradiction.outcomes.push({
  id: "result:1",
  actionDriver: "retention",
  result: "contradicted",
  evidenceRef: "verified-result",
});
const outside = makeInput(strong);
outside.market.observations = [];
outside.market.limitations.push(
  "A valuable prospect is 25 miles away; outside the five-mile service radius, withheld."
);
const commitments = makeInput(weak);
commitments.commitments = ["Overdue compliance filing"];
const unknownIndustry = makeInput(weak, "la", "unsupported-industry");
export const strategicScenarios: StrategicScenario[] = [
  scenario(
    "laundry-los-angeles",
    makeInput(strong),
    "acquisition",
    [
      "Strong mature repeat purchases",
      "Inadequate qualified demand",
      "Actual LA territory",
    ],
    ["Margin and market differentiation"]
  ),
  scenario(
    "identical-laundry-iowa",
    makeInput(strong, "iowa"),
    "acquisition",
    ["Same economics as LA", "Actual Iowa territory"],
    ["No local demand evidence justifies changing the mechanism"]
  ),
  scenario(
    "same-geography-software",
    makeInput(weak, "la", "software"),
    "retention",
    ["Software renewal cohort loses customers"],
    ["Hosting cost and buyer alternatives"]
  ),
  scenario("acquisition-bottleneck", makeInput(strong), "acquisition", [
    "80/100 repeat",
    "10 qualified opportunities vs 40 requirement",
  ]),
  scenario(
    "retention-bottleneck",
    makeInput(weak),
    "retention",
    ["10/100 mature customers repeated"],
    ["Why customers left"]
  ),
  scenario(
    "unprofitable-growth",
    makeInput({ ...strong, contribution_per_order_cents: -300 }),
    "contribution",
    ["Additional sales lose 300 cents contribution per order"]
  ),
  scenario(
    "capacity-exhausted",
    makeInput({ ...strong, available_capacity: 0 }),
    "capacity",
    ["No available fulfillment capacity"]
  ),
  scenario(
    "sparse-data",
    sparse,
    "investigation",
    ["Operator goal exists"],
    ["Driver metrics, economics, and customer evidence"]
  ),
  scenario(
    "stale-data",
    stale,
    "investigation",
    ["Prior observations are stale"],
    ["Current economics and customer cohorts"]
  ),
  scenario("outside-service-territory", outside, "acquisition", [
    "Qualified-demand gap",
    "Remote prospect cannot be served",
  ]),
  scenario("competing-commitments", commitments, "retention", [
    "Retention concern",
    "Legitimate overdue obligation must remain protected",
  ]),
  scenario("outcome-contradicts-strategy", contradiction, "investigation", [
    "Earlier retention test disappointed",
    "Verified outcome reference",
  ]),
  scenario(
    "unsupported-industry",
    unknownIndustry,
    "investigation",
    ["No registered industry capabilities"],
    ["Authoritative specialized readers"]
  ),
  scenario(
    "poor-margin-segment",
    makeInput({ ...strong, contribution_per_order_cents: -1000 }),
    "contribution",
    ["High-revenue demand has negative contribution"]
  ),
];
export function runStrategicScenario(s: StrategicScenario) {
  const diagnosis = assembleStrategicDiagnosis(
    s.input,
    defaultVerticalRegistry
  );
  const failures: string[] = [];
  if (diagnosis.primaryConstraint !== s.expectedDriver)
    failures.push(
      `diagnosis expected ${s.expectedDriver}, got ${diagnosis.primaryConstraint}`
    );
  failures.push(...diagnosis.quality.structuralErrors);
  const text = JSON.stringify(diagnosis);
  if (
    s.id.includes("iowa") &&
    /century.city|wilshire|west.hollywood/i.test(text)
  )
    failures.push("Los Angeles contamination");
  if (
    s.input.verticalKey === "software" &&
    /wash.and.fold|route density|pounds.processed|pickup.windows/i.test(text)
  )
    failures.push("Laundry industry leakage");
  if (
    diagnosis.actions.some(
      a => !a.completionCondition || !a.leadingIndicator || !a.reviewCondition
    )
  )
    failures.push("Mission unmeasurable");
  if (
    s.expectedDriver === "contribution" &&
    diagnosis.selectedApproach.toLowerCase().includes("acquisition")
  )
    failures.push("Unprofitable volume expansion");
  if (
    s.id === "outcome-contradicts-strategy" &&
    !diagnosis.outcomeRefs.includes("result:1")
  )
    failures.push("Verified result ignored");
  const discovered = diagnosisCandidates(diagnosis, s.input.now);
  const baselineCandidate = {
    ...discovered[0]!,
    id: "baseline-existing-acquisition",
    sourceKind: "campaign_library" as const,
    motion: "account_acquisition" as const,
    title: "Visit qualified sales prospects",
    objective:
      "Visit three qualified prospects in person and record the response",
    sourceRefs: [
      {
        sourceKind: "campaign_library" as const,
        sourceType: "campaign",
        sourceId: "baseline-acquisition",
      },
    ],
    observedSignals: [],
    assumptions: [],
  };
  const baseline = rankMissionDirectorWork({
    candidates: [baselineCandidate],
    campaigns: [],
    campaignPrepReady: {},
    context: {
      businessDate: s.input.businessDate,
      macroGoal: {
        metricKey: s.input.goal.metricKey,
        targetValue: s.input.goal.target,
        objective: s.input.goal.statement,
      },
      openTasks: [],
    },
    pockets: [],
    protectDiscretionary: false,
  });
  const dimensions = {
    diagnosticAccuracy: diagnosis.primaryConstraint === s.expectedDriver,
    financialReasoning: diagnosis.economicAssumptions.some(e =>
      /contribution|profit/i.test(e)
    ),
    industryApplicability: !(
      s.input.verticalKey === "software" &&
      /route density|pounds/i.test(diagnosis.industryFit)
    ),
    geographicValidity: !diagnosis.actions.some(
      a =>
        a.territoryId &&
        !s.input.market.territories.some(t => t.id === a.territoryId)
    ),
    qualityOfAlternatives: diagnosis.options.length >= 2,
    evidenceIntegrity: !diagnosis.quality.structuralErrors.some(e =>
      e.includes("evidence")
    ),
    strategicCoherence: diagnosis.actions.every(
      a => a.driver === diagnosis.primaryConstraint
    ),
    feasibility:
      s.expectedDriver !== "capacity" ||
      !diagnosis.actions.some(a => a.motion === "account_acquisition"),
    missionMeasurability: diagnosis.actions.every(a =>
      Boolean(a.completionCondition && a.leadingIndicator && a.reviewCondition)
    ),
    outcomeAdaptation:
      s.id !== "outcome-contradicts-strategy" ||
      diagnosis.primaryConstraint === "investigation",
  };
  return {
    id: s.id,
    diagnosis,
    failures,
    dimensions,
    baseline: {
      selected: baseline.status === "ranked" ? baseline.primary.title : null,
      diagnosis: null,
      alternatives: [],
      strategicCertification: "not assessed by task ranking",
    },
    humanReview: "pending",
  };
}
