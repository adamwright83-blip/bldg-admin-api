import { type MysqlPresidentIntelligenceStore } from "./intelligenceStore";
const metrics = [
  [
    "acquisition",
    null,
    "Acquisition supplies potential activated customers",
    "count",
    "PostHog verified acquisition funnel",
  ],
  [
    "activation",
    "acquisition",
    "Activation converts first contact into demonstrated value",
    "rate",
    "PostHog verified activation cohort",
  ],
  [
    "trial_start",
    "activation",
    "Trial starts create a measurable paid-conversion opportunity",
    "count",
    "Authoritative billing/trial records",
  ],
  [
    "trial_to_paid",
    "trial_start",
    "Conversion turns eligible trials into paid subscriptions",
    "rate",
    "Authoritative billing and subscription records",
  ],
  [
    "retention",
    "trial_to_paid",
    "Retention sustains customer value and recurring revenue",
    "rate",
    "PostHog cohorts plus authoritative subscription records",
  ],
  [
    "MRR",
    "retention",
    "Paid retained subscriptions support recurring revenue",
    "USD/month",
    "Authoritative billing ledger",
  ],
  [
    "AI_cost",
    "MRR",
    "AI cost reduces contribution margin and constrains scalable service",
    "USD/month",
    "Verified provider usage and company cost attribution",
  ],
  [
    "gross_margin",
    "MRR",
    "Revenue less attributable delivery cost supports sustainable growth",
    "rate",
    "Verified revenue and delivery-cost ledgers",
  ],
  [
    "reliability",
    "activation",
    "Reliable service enables successful activation and retention",
    "rate",
    "Verified deployment/error and continuity evidence",
  ],
] as const;
export async function persistUnknownMetricTree(
  store: MysqlPresidentIntelligenceStore,
  unavailableEvidenceId: string,
  requestKey: string
) {
  const [evidence] = await store.evidence([unavailableEvidenceId]);
  if (
    !evidence ||
    evidence.kind !== "UNKNOWN" ||
    evidence.availability !== "UNAVAILABLE"
  )
    throw new Error(
      "Unknown tree requires explicit unavailable-source provenance"
    );
  const records = [];
  for (const [name, parent, causalHypothesis, unit, source] of metrics)
    records.push(
      await store.appendCurrent({
        kind: "METRIC",
        key: name,
        payload: {
          name,
          parent,
          causalHypothesis,
          source,
          asOf: null,
          confidence: 0,
          availability: "UNKNOWN",
          value: null,
          unit,
        },
        evidenceIds: [unavailableEvidenceId],
        idempotencyKey: requestKey + ":" + name,
      })
    );
  return records;
}
