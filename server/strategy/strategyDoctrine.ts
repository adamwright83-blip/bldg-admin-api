import type { StrategicDiagnosis } from "../../shared/strategicIntelligence";
import { territoryForPoint, validTerritory } from "./marketContext";
export const STRATEGY_DOCTRINE_VERSION = "2026-10-13.1";
/** Original paraphrases; sources describe methods, not guarantees of efficacy. */
export const STRATEGY_DOCTRINE = [
  {
    id: "diagnosis",
    rule: "Identify the pivotal constraint before selecting coherent action.",
    source: "https://www.richardrumelt.com/articles",
  },
  {
    id: "choice",
    rule: "Choose a customer arena and a credible way to win; expose alternatives.",
    source: "https://rogerlmartin.com/lets-read/playing-to-win",
  },
  {
    id: "tradeoffs",
    rule: "Name trade-offs and test whether activities reinforce the selected position.",
    source: "https://www.isc.hbs.edu/strategy/Pages/strategy-explained.aspx",
  },
  {
    id: "learning",
    rule: "Treat an action as a hypothesis; review observed business results separately from completion.",
    source: "https://theleanstartup.com/principles",
  },
  {
    id: "execution",
    rule: "Connect the goal to lead measures, a visible result measure, and a review cadence.",
    source: "https://www.franklincovey.com/courses/the-4-disciplines/",
  },
  {
    id: "evidence",
    rule: "Test the most consequential unknown with bounded effort before scaling investment.",
    source:
      "https://www.strategyzer.com/library/testing-business-ideas-book-summary",
  },
] as const;

export function validateStrategicDiagnosis(d: StrategicDiagnosis): string[] {
  const errors: string[] = [];
  const observedAt = Date.parse(d.generatedAt);
  const refs = new Set(
    d.evidence
      .filter(
        e =>
          e.tenantId === d.tenantId &&
          e.source &&
          Number.isFinite(Date.parse(e.capturedAt)) &&
          Date.parse(e.capturedAt) <= observedAt
      )
      .map(e => e.id)
  );
  if (
    !Number.isFinite(observedAt) ||
    d.evidence.some(e => Date.parse(e.capturedAt) > observedAt)
  )
    errors.push("Future or invalid evidence timestamp");
  const check = (ids: string[], label: string) => {
    if (!ids.length) errors.push(`${label}: missing evidence`);
    if (ids.some(id => !refs.has(id)))
      errors.push(`${label}: invalid evidence reference`);
  };
  if (d.doctrineVersion !== STRATEGY_DOCTRINE_VERSION)
    errors.push("Unsupported doctrine version");
  if (!d.diagnosis || !d.primaryConstraint) errors.push("Missing diagnosis");
  check(d.supportingEvidence, "diagnosis");
  if (d.options.length < 2)
    errors.push("At least two alternatives are required");
  const selected = d.options.find(o => o.id === d.selectedOptionId);
  if (!selected?.eligible || selected.approach !== d.selectedApproach)
    errors.push("Selected approach is not eligible");
  for (const o of d.options) {
    check(o.evidenceRefs, `option:${o.id}`);
    if (
      ![
        o.economics,
        o.cost,
        o.effort,
        o.timeToResults,
        o.capacity,
        o.risk,
        o.reversibility,
        o.reason,
      ].every(Boolean)
    )
      errors.push(`option:${o.id}: incomplete comparison`);
  }
  if (
    !d.economicAssumptions.length ||
    !d.uncertainty.length ||
    !d.successMeasures.length ||
    !d.revisionTrigger ||
    !d.customerUnderstanding ||
    !d.localFit ||
    !d.industryFit ||
    !d.notPrioritized.length
  )
    errors.push("Missing economics, fit, uncertainty, trade-off, or review");
  if (
    d.market.tenantId !== d.tenantId ||
    d.evidence.some(e => e.tenantId !== d.tenantId)
  )
    errors.push("Cross-tenant evidence");
  for (const observation of d.market.observations) {
    const territory = d.market.territories.find(
      t => t.id === observation.territoryId
    );
    if (
      !territory ||
      !validTerritory(territory) ||
      !territoryForPoint([territory], {
        lat: observation.latitude,
        lng: observation.longitude,
      }) ||
      !observation.source ||
      !Number.isFinite(Date.parse(observation.capturedAt)) ||
      Date.parse(observation.capturedAt) > observedAt ||
      observation.demandVerified !== false
    )
      errors.push(
        `observation:${observation.id}: invalid local provenance or demand claim`
      );
  }
  for (const action of d.actions) {
    check(action.evidenceRefs, `action:${action.id}`);
    if (action.driver !== selected?.driver)
      errors.push(`action:${action.id}: incoherent driver`);
    if (
      ![
        action.hypothesis,
        action.rationale,
        action.completionCondition,
        action.leadingIndicator,
        action.intendedOutcome,
        action.reviewCondition,
      ].every(Boolean)
    )
      errors.push(`action:${action.id}: not measurable`);
    if (
      action.territoryId &&
      !d.market.territories.some(
        t => t.id === action.territoryId && validTerritory(t)
      )
    )
      errors.push(`action:${action.id}: unresolved geography`);
  }
  if (d.primaryConstraint !== "investigation" && !d.actions.length)
    errors.push("Missing coherent work");
  return errors;
}
