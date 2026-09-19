import { CLAIRE_CANON } from "../character/characterDefinition";
import type { CanonFragment } from "../character/types";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import type { PersonalProgressionContext } from "./service";

/**
 * Personal Conversation Controller — pure planning. The server decides truth
 * and permission; the model only ever presents what this plan allows.
 *
 * Invoked only when the operator has explicitly asked a personal question, so
 * "ask-only" and field-mode silence are preserved by construction: this never
 * runs, and Claire never volunteers biography, on any other turn.
 */

/** Which canon fragments can answer each supported topic, most direct first. */
export const TOPIC_FRAGMENT_PRIORITY: Record<string, readonly string[]> = {
  age: ["core_age"],
  childhood: ["core_childhood", "core_nationality"],
  background: ["core_study", "core_field_work", "core_nationality"],
  father: ["core_father_career", "core_father_disappearance"],
  professional_failure: ["core_field_failure"],
  past_relationship: ["core_relationship"],
  central_wound: ["core_central_wound"],
  is_she_real: ["core_ontology"],
};

export type DeclineReason =
  | "no_canon_for_topic"
  | "permanently_private"
  | "rung_too_low"
  | "no_entitlement"
  | "personal_budget_exhausted";

export type PersonalTurnPlan =
  | {
      kind: "answer";
      /** How the answer is authorized. */
      basis: "core" | "previously_disclosed" | "new_disclosure";
      fragment: CanonFragment;
      /** Present only for basis === "new_disclosure": consumes one entitlement on commit. */
      needsEntitlement: boolean;
      isFollowUpOnDisclosedSubject: boolean;
      previouslyRefusedTopic: boolean;
      /** True once this answer uses the last of the current-call budget. */
      closesThreadAfter: boolean;
    }
  | {
      kind: "decline";
      reason: DeclineReason;
      /** Close the personal subject (budget spent) rather than merely refuse this question. */
      closeThread: boolean;
      eligibleFragmentId: string | null;
      hadUnusedEntitlement: boolean;
    };

const fragmentById = (id: string) => CLAIRE_CANON.find(fragment => fragment.id === id);

/** Personal answers spoken in this conversation that count against the budget (gated material only). */
export function personalExchangesUsed(context: PersonalProgressionContext): number {
  return context.conversationLedger.filter(
    row => row.kind === "disclosed" || row.kind === "followup_answered"
  ).length;
}

export function planPersonalTurn(input: {
  topic: string | null;
  context: PersonalProgressionContext;
  policy?: ProgressionPolicy;
}): PersonalTurnPlan {
  const policy = input.policy ?? PROGRESSION_POLICY;
  const { context } = input;
  const rung = context.grant.personalRung;
  const hadUnusedEntitlement = context.unusedEntitlement !== null;
  const decline = (reason: DeclineReason, extra?: { fragment?: CanonFragment; closeThread?: boolean }): PersonalTurnPlan => ({
    kind: "decline",
    reason,
    closeThread: extra?.closeThread ?? false,
    eligibleFragmentId: extra?.fragment?.id ?? null,
    hadUnusedEntitlement,
  });

  const priority = input.topic ? TOPIC_FRAGMENT_PRIORITY[input.topic] : undefined;
  if (!priority) {
    // A recognized-but-unmapped topic: permanently private canon carries no fact text at all.
    const privateTopic = CLAIRE_CANON.some(fragment => fragment.accessClass === "permanently_private" && fragment.topic === input.topic);
    return decline(privateTopic ? "permanently_private" : "no_canon_for_topic");
  }

  const fragments = priority.map(fragmentById).filter((fragment): fragment is CanonFragment => Boolean(fragment?.fact));
  if (!fragments.length) return decline("no_canon_for_topic");

  const budget = policy.personalExchangeBudget[rung];
  const used = personalExchangesUsed(context);
  const disclosed = new Set(context.disclosedFragmentIds);
  const previouslyRefusedTopic = input.topic ? context.priorRefusedTopics.includes(input.topic) : false;

  const core = fragments.find(fragment => fragment.accessClass === "core");
  const gatedNew = fragments.find(
    fragment => fragment.accessClass !== "core" && !disclosed.has(fragment.id) && rung >= fragment.minTier
  );
  const gatedDisclosed = fragments.find(fragment => fragment.accessClass !== "core" && disclosed.has(fragment.id));
  const lockedByRung = fragments.find(fragment => fragment.accessClass !== "core" && !disclosed.has(fragment.id) && rung < fragment.minTier);

  // Gated material draws on the per-call budget. Core facts never do.
  const budgetSpent = used >= budget;

  if (gatedNew && context.unusedEntitlement) {
    if (budgetSpent) return decline("personal_budget_exhausted", { fragment: gatedNew, closeThread: true });
    return {
      kind: "answer",
      basis: "new_disclosure",
      fragment: gatedNew,
      needsEntitlement: true,
      isFollowUpOnDisclosedSubject: Boolean(gatedDisclosed),
      previouslyRefusedTopic,
      closesThreadAfter: used + 1 >= budget,
    };
  }
  if (gatedDisclosed) {
    // Already known to the operator: discussing it again mints and consumes nothing, still spends budget.
    if (budgetSpent) return decline("personal_budget_exhausted", { fragment: gatedDisclosed, closeThread: true });
    return {
      kind: "answer",
      basis: "previously_disclosed",
      fragment: gatedDisclosed,
      needsEntitlement: false,
      isFollowUpOnDisclosedSubject: true,
      previouslyRefusedTopic,
      closesThreadAfter: used + 1 >= budget,
    };
  }
  if (core) {
    return {
      kind: "answer",
      basis: "core",
      fragment: core,
      needsEntitlement: false,
      isFollowUpOnDisclosedSubject: false,
      previouslyRefusedTopic,
      closesThreadAfter: false,
    };
  }
  if (gatedNew && !context.unusedEntitlement) return decline("no_entitlement", { fragment: gatedNew });
  if (lockedByRung) return decline("rung_too_low", { fragment: lockedByRung });
  return decline("no_canon_for_topic");
}
