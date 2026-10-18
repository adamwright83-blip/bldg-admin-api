import { createHash } from "node:crypto";
import type {
  BusinessDriver,
  StrategicChallenge,
  StrategicChallengeAbstention,
  StrategicCohortMember,
  StrategyEvidence,
} from "../../shared/strategicIntelligence";
import { workThreadOpportunityKey, type StrategyOpportunity } from "../../shared/workThread";
import type { DiagnosisInput, DiagnosisMandate } from "./strategicDiagnosis";

/**
 * Evidence-backed strategic challenge (Phase 2 · Slice E).
 *
 * When the operator has stated how to pursue a goal and the recorded evidence
 * favors a different approach for the same goal and area, Claire prepares the
 * comparison: the stated method and the goal it serves, its Work Thread, the
 * evidence for and against, what is uncertain, the alternative with a real
 * customer cohort and who is left out of it, and what she did on her own
 * versus what needs the operator. It is optional and evidence-triggered:
 * abstaining is the default, and every abstention says why. Confirmed
 * constraints come first: an alternative they rule out is never proposed. No
 * contact, spend or change of approach follows from a challenge. No return is
 * estimated: neither approach has been measured for the business.
 */
export const CHALLENGE_POLICY_VERSION = "strategic-challenge-v1";

/** The approach the evidence alone prefers for the focus, without the stated method. */
export type EvidencePlanView = {
  driver: BusinessDriver;
  chosen: string;
  population: "lapsed_customers" | "new_customers";
};

type Focus = NonNullable<DiagnosisInput["focus"]>;
type Result = { challenge: StrategicChallenge } | { abstained: StrategicChallengeAbstention };

const abstain = (
  reason: StrategicChallengeAbstention["reason"],
  detail: string,
  constraintRefs: string[] = []
): Result => ({ abstained: { reason, detail, constraintRefs } });

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Pure. Null when the operator stated no method: there is nothing to challenge. */
export function prepareStrategicChallenge(input: {
  verticalKey: string;
  mandate: DiagnosisMandate;
  focus: Focus | null;
  focusKey: string | null;
  /** Why the stated method is on hold (a hard business constraint or incomplete data), if it is. */
  methodHeldReason: string | null;
  methodFitsFocus: boolean;
  /** A verified result contradicted the method's lever, so the plan reviews it first. */
  revisitingFailedHypothesis: boolean;
  evidencePlan: EvidencePlanView | null;
  outcomes: DiagnosisInput["outcomes"];
  byId: ReadonlyMap<string, StrategyEvidence>;
  metrics: DiagnosisInput["metrics"];
  workThreadIds: Readonly<Record<string, string>> | undefined;
  methodOpportunity: StrategyOpportunity | null;
  observationWindowDays: number;
}): Result | null {
  const method = input.mandate.method;
  if (!method) return null;
  if (input.methodHeldReason)
    return abstain("method_on_hold", `Your stated approach is on hold (${input.methodHeldReason}), so there is nothing to compare yet.`);
  if (input.revisitingFailedHypothesis)
    return abstain("method_on_hold", "A verified result contradicted this approach; the plan reviews it before repeating it.");
  const focus = input.focus;
  if (!focus || !input.focusKey || !input.methodFitsFocus)
    return abstain(
      "insufficient_evidence",
      "A challenge compares two approaches for one area against that area's own customers; your stated approach has no such area in the current focus."
    );
  const area = focus.area;
  const verified = (ref: string | null | undefined) => {
    const e = ref ? input.byId.get(ref) : undefined;
    return Boolean(e && e.classification === "verified" && e.quality === "complete");
  };
  if (method.population === "lapsed_customers")
    return (focus.dormant ?? 0) > 0
      ? abstain("method_matches_evidence", `The evidence also favors winning back lapsed ${area} customers first.`)
      : abstain("insufficient_evidence", `No lapsed ${area} customers are on record, so there is no list to compare your approach with.`);
  if (input.evidencePlan?.population !== "lapsed_customers")
    return abstain("method_matches_evidence", `No lapsed ${area} customers are on record, so the evidence also points to new customers.`);
  if (!verified(focus.dormantRef) || !focus.dormantMembers?.length)
    return abstain("insufficient_evidence", `The lapsed ${area} customers could not be listed from verified orders.`);
  if (input.outcomes.some(o => o.result === "contradicted" && o.actionDriver === "retention" && verified(o.evidenceRef)))
    return abstain("alternative_contradicted", "A verified result already contradicted winning customers back, so Claire does not argue for it.");

  // Confirmed constraints come first: an alternative they rule out is not proposed.
  const constraints = input.mandate.constraints ?? [];
  const skipSales = constraints.find(c => c.key === "skipSalesUntil");
  if (skipSales)
    return abstain(
      "constraint_precludes_alternative",
      `${skipSales.statement} Winning customers back means contacting them, so it is not proposed.`,
      [skipSales.id]
    );
  const minimumRule = constraints.find(c => c.key === "minPriorOrders");
  const minimum = typeof minimumRule?.value === "number" ? minimumRule.value : null;
  const members: StrategicCohortMember[] = [];
  const exclusions: StrategicChallenge["alternative"]["cohort"]["exclusions"] = [];
  const lapsed = [...focus.dormantMembers].sort(
    (a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name) || String(a.identityKey).localeCompare(String(b.identityKey))
  );
  for (const m of lapsed) {
    if (!m.matched || !m.identityKey) {
      exclusions.push({ identityKey: null, displayName: m.name, reason: "No customer identity on record, so they cannot be contacted or followed up.", constraintRef: null });
    } else if (minimum !== null && minimumRule && m.paidOrders < minimum) {
      exclusions.push({
        identityKey: m.identityKey,
        displayName: m.name,
        reason: `Fewer than ${minimum} paid orders (${minimumRule.origin === "operator_doctrine" ? "your rule" : "the default rule"}).`,
        constraintRef: minimumRule.id,
      });
    } else {
      members.push({ identityKey: m.identityKey, displayName: m.name, lastOrderDate: m.lastOrderDate, paidOrders: m.paidOrders, revenueCents: m.revenueCents });
    }
  }
  if (!members.length) {
    const ruled = [...new Set(exclusions.flatMap(e => (e.constraintRef ? [e.constraintRef] : [])))];
    return ruled.length
      ? abstain("constraint_precludes_alternative", `Your rules leave out every lapsed ${area} customer, so winning them back is not proposed.`, ruled)
      : abstain("insufficient_evidence", `None of the lapsed ${area} customers has an identity Claire can follow up.`);
  }

  const alternativeOpportunity: StrategyOpportunity = {
    kind: "strategy_opportunity",
    verticalKey: input.verticalKey,
    lever: "retention",
    population: "lapsed_customers",
    area: input.focusKey,
  };
  const outcomeId = method.outcomeId ?? input.mandate.leadingOutcomeId;
  const outcome = input.mandate.outcomes.find(o => o.id === outcomeId) ?? null;
  const perDay = constraints.find(c => c.key === "maxRecoveryPerDay")?.value;
  const newCustomersRef = input.metrics.new_customers_30d;
  const newCustomers = newCustomersRef ? input.byId.get(newCustomersRef) : undefined;
  const evidenceFor: StrategicChallenge["evidenceFor"] = [];
  if (newCustomersRef && newCustomers && typeof newCustomers.value === "number" && newCustomers.value > 0)
    evidenceFor.push({
      ref: newCustomersRef,
      statement: `${newCustomers.value} new customers in the last 30 days: the business does win new customers (business-wide, not ${area} alone).`,
    });
  const evidenceAgainst: StrategicChallenge["evidenceAgainst"] = [
    {
      ref: focus.dormantRef!,
      statement: `${focus.dormant} ${area} customers ordered before and have no order in the last 60 days; ${members.length} can be followed up.`,
    },
    ...input.outcomes
      .filter(o => o.result === "contradicted" && o.actionDriver === method.lever && verified(o.evidenceRef))
      .map(o => ({ ref: o.evidenceRef, statement: "A verified result contradicted this approach before." })),
    ...input.outcomes
      .filter(o => o.result === "supported" && o.actionDriver === "retention" && verified(o.evidenceRef))
      .map(o => ({ ref: o.evidenceRef, statement: "A verified result was consistent with winning customers back before (not proof it caused it)." })),
  ];
  const id = `challenge_${createHash("sha256")
    .update(
      JSON.stringify({
        policy: CHALLENGE_POLICY_VERSION,
        method: method.id,
        alternative: workThreadOpportunityKey(alternativeOpportunity),
        members: members.map(m => m.identityKey),
        exclusions: exclusions.map(e => [e.identityKey ?? e.displayName, e.reason]),
      })
    )
    .digest("hex")
    .slice(0, 40)}`;
  const contactsPerDay = typeof perDay === "number" && perDay > 0 ? Math.min(perDay, members.length) : members.length;
  return {
    challenge: {
      id,
      status: "raised",
      statedMethod: { id: method.id, statement: method.statement, lever: method.lever, population: method.population, area: method.area },
      outcome: outcome ? { id: outcome.id, statement: outcome.statement } : null,
      workThreadId: input.methodOpportunity ? input.workThreadIds?.[workThreadOpportunityKey(input.methodOpportunity)] ?? null : null,
      claim: `${focus.dormant} lapsed ${area} customers already know the service. Winning some back can be measured within ${input.observationWindowDays} days and needs no acquisition spend, so the evidence favors trying it before ${lowerFirst(method.statement)}.`,
      evidenceFor,
      evidenceAgainst,
      uncertainty: [
        ...(evidenceFor.length ? [] : [`No recorded evidence yet shows how new ${area} customers convert.`]),
        "Neither approach has been measured for this business, so their results cannot be compared yet; no return is estimated.",
        "Why these customers stopped ordering is unknown, and their return rate is unobserved.",
        "Contact permission is checked only when you approve contacting anyone; a phone number is not consent.",
      ],
      alternative: {
        approach: input.evidencePlan.chosen,
        opportunity: alternativeOpportunity,
        workThreadId: input.workThreadIds?.[workThreadOpportunityKey(alternativeOpportunity)] ?? null,
        cohort: {
          basis: `Customers with earlier paid orders and none in the last 60 days, read from the canonical business query for ${area} (recorded address ZIP or name).`,
          sourceRef: focus.dormantRef!,
          members,
          exclusions,
        },
        nextMeasurableAction: `If you choose it: contact up to ${contactsPerDay} a day from the list with a return offer you approve, and record replies and orders within ${input.observationWindowDays} days.`,
      },
      autonomy: {
        preparedWithoutApproval: ["This comparison", `The list of lapsed ${area} customers and who is left out, read from your own orders`],
        requiresApproval: [
          `Switching from your approach (${method.statement}) to this one`,
          "Contacting anyone on the list",
          "Any offer, discount or spend",
        ],
      },
    },
  };
}
