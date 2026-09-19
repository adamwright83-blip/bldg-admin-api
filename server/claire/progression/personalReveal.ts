import { CLAIRE_CANON } from "../character/characterDefinition";
import { assertNoUngroundedPersonalSpecificity, UngroundedPersonalSpecificityError } from "../character/personalSpecificityGuard";
import type { CanonFragment } from "../character/types";
import { AUTHORED_DIALOGUE, type DialogueLine } from "./authoredDialogue";
import { selectDialogueLine } from "./dialogueRegistry";
import { planPersonalTurn, type DeclineReason, type PersonalTurnPlan } from "./personalController";
import {
  abandonDisclosure,
  commitDisclosure,
  loadPersonalProgressionContext,
  reserveDisclosureEntitlement,
  type PersonalProgressionContext,
} from "./service";
import type { OperatorScope, ProgressionStore } from "./store";
import { RAPPORT_SHORT } from "./rapportPresentation";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";

/**
 * Personal reveal delivery. Canon is SOURCE TRUTH, never dialogue: there is no
 * deterministic first-person canon renderer anywhere on this path. The model
 * phrases only the bounded fragment the server allowed; anything that fails
 * validation is replaced by an operator-approved decline and the fragment stays
 * undisclosed with its entitlement unused.
 */

export type PersonalGenerationRequest = {
  fragment: CanonFragment;
  plan: Extract<PersonalTurnPlan, { kind: "answer" }>;
  rapportBand: 0 | 1 | 2 | 3;
  rung: 0 | 1 | 2 | 3;
  /** The operator asked about this topic before and was declined. Claire may acknowledge it, without explaining why now. */
  previouslyRefusedTopic: boolean;
};

export type PersonalGenerator = (request: PersonalGenerationRequest) => Promise<string>;

const RAPPORT_PRESENTATION = RAPPORT_SHORT;

/**
 * The bounded contract handed to the model. Presentation only: the model may
 * hesitate, qualify, answer partially, be dry, or close the topic; it may not
 * add any biography beyond the single fact below.
 */
export function buildPersonalDisclosureGuidance(request: PersonalGenerationRequest): string {
  return [
    `The operator asked a personal question. The ONLY personal fact you may draw on: "${request.fragment.fact}"`,
    "Answer in your own voice, briefly. You may hesitate, qualify, answer only part of it, be dry, or close the topic. Do not recite the fact as a sentence read from a file.",
    "Add no other biography: no names, places, dates, numbers, causes, or people beyond that fact. If pressed for more, decline in character.",
    "Do not mention rapport, trust, levels, unlocking, or why you are answering now. Do not offer more.",
    RAPPORT_PRESENTATION[request.rapportBand],
    request.previouslyRefusedTopic
      ? "He has asked about this before and you declined. You may acknowledge that in a word, without explaining what changed."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const NOISE_WORDS = new Set([
  "claire", "career", "which", "while", "would", "their", "there", "about", "because", "through",
]);

/** Distinctive content words of a fragment that another answer must not reproduce. */
function distinctiveWords(fact: string, exclude: string): string[] {
  const excluded = new Set(exclude.toLowerCase().match(/[a-z]{6,}/g) ?? []);
  return [...new Set(fact.toLowerCase().match(/[a-z]{6,}/g) ?? [])].filter(
    word => !excluded.has(word) && !NOISE_WORDS.has(word)
  );
}

export type PersonalValidationFailure =
  | "ungrounded_specificity"
  | "ineligible_canon_leak"
  | "ungrounded_number"
  | "empty_answer";

/** Returns null when the text is safe to deliver. */
export function validatePersonalAnswer(
  text: string,
  fragment: CanonFragment,
  options?: { allowedFragmentIds?: readonly string[] }
): PersonalValidationFailure | null {
  if (!text.trim()) return "empty_answer";
  try {
    assertNoUngroundedPersonalSpecificity(text, [fragment.fact]);
  } catch (error) {
    if (error instanceof UngroundedPersonalSpecificityError) return "ungrounded_specificity";
    throw error;
  }
  const factDigits = new Set(fragment.fact.match(/\d+/g) ?? []);
  for (const digits of text.match(/\d+/g) ?? []) {
    if (!factDigits.has(digits)) return "ungrounded_number";
  }
  const allowed = new Set([fragment.id, ...(options?.allowedFragmentIds ?? [])]);
  const lowered = text.toLowerCase();
  for (const other of CLAIRE_CANON) {
    if (allowed.has(other.id) || !other.fact || other.accessClass === "core") continue;
    const distinct = distinctiveWords(other.fact, fragment.fact);
    if (distinct.filter(word => lowered.includes(word)).length >= 2) return "ineligible_canon_leak";
  }
  return null;
}

export type DisclosureReceipt = {
  fragmentId: string;
  commit: () => Promise<boolean>;
  abandon: () => Promise<boolean>;
};

export type PersonalTurnOutcome =
  | "answered_core"
  | "answered_previously_disclosed"
  | "answered_new_disclosure"
  | "declined";

export type PersonalTurnResult = {
  text: string;
  outcome: PersonalTurnOutcome;
  plan: PersonalTurnPlan;
  declineId: string | null;
  failureReason: string | null;
  fragmentId: string | null;
  /** The personal subject is closed for the rest of this call. The call itself continues. */
  closedThread: boolean;
  /** True only when the business agenda is complete AND an authored exit line exists. */
  endCall: boolean;
  /** Unresolved business remains; the caller/next turn should steer back to it. */
  returnToBusiness: boolean;
  /** Present for a new disclosure not yet committed. Uncommitted reservations expire back to unused. */
  receipt: DisclosureReceipt | null;
};

export async function executePersonalTurn(input: {
  store: ProgressionStore;
  scope: OperatorScope;
  conversationId: string;
  topic: string | null;
  generate: PersonalGenerator;
  /** Whether unresolved operational work remains in this conversation. */
  businessOpen: boolean;
  registry?: readonly DialogueLine[];
  policy?: ProgressionPolicy;
  random?: () => number;
  now?: () => Date;
  /** Commit new disclosures immediately (callers with a real delivery boundary pass false and commit later). */
  autoCommit?: boolean;
}): Promise<PersonalTurnResult> {
  const now = input.now ?? (() => new Date());
  const registry = input.registry ?? AUTHORED_DIALOGUE;
  const policy = input.policy ?? PROGRESSION_POLICY;
  const context: PersonalProgressionContext = await loadPersonalProgressionContext(
    input.store,
    input.scope,
    input.conversationId,
    now
  );
  const band = context.grant.rapportBand;
  const rung = context.grant.personalRung;
  const base = {
    ...input.scope,
    conversationId: input.conversationId,
    rungAtTime: rung,
    rapportBandAtTime: band,
  };

  await input.store.appendLedger({
    ...base, kind: "asked", topic: input.topic, fragmentId: null, entitlementId: null,
    declineId: null, failureReason: null, hadUnusedEntitlement: null, failurePhase: null,
  });

  const alreadyClosed = context.conversationLedger.some(row => row.kind === "thread_closed");
  let plan = planPersonalTurn({ topic: input.topic, context, policy });
  if (alreadyClosed && plan.kind === "answer" && plan.basis !== "core") {
    plan = {
      kind: "decline", reason: "personal_budget_exhausted", closeThread: true,
      eligibleFragmentId: plan.fragment.id, hadUnusedEntitlement: context.unusedEntitlement !== null,
    };
  }

  const recentDeclineIds = (await input.store.listLedger(input.scope))
    .map(row => row.declineId)
    .filter((id): id is string => Boolean(id))
    .slice(-6);

  const decline = async (
    reason: DeclineReason | string,
    details: { closeThread: boolean; fragmentId: string | null; phase: "pre_generation" | "post_validation" | null }
  ): Promise<PersonalTurnResult> => {
    const closing = details.closeThread;
    const line = selectDialogueLine({
      category: closing ? "thread_closer" : "decline",
      rapportBand: band,
      recentlyUsedIds: recentDeclineIds,
      registry,
      random: input.random,
    });
    // The generic floor guarantees a line; if a custom registry somehow has none, fail closed to silence-safe text.
    const declineLine = line ?? selectDialogueLine({ category: "decline", rapportBand: 0, registry: AUTHORED_DIALOGUE, random: input.random })!;
    await input.store.appendLedger({
      ...base, kind: "decline_fallback", topic: input.topic, fragmentId: details.fragmentId, entitlementId: null,
      declineId: declineLine.id, failureReason: reason, hadUnusedEntitlement: context.unusedEntitlement !== null,
      failurePhase: details.phase,
    });
    if (closing) {
      await input.store.appendLedger({
        ...base, kind: "thread_closed", topic: input.topic, fragmentId: null, entitlementId: null,
        declineId: null, failureReason: reason, hadUnusedEntitlement: null, failurePhase: null,
      });
    }
    let text = declineLine.text;
    let endCall = false;
    let returnToBusiness = false;
    if (closing) {
      if (input.businessOpen) {
        returnToBusiness = true;
        const pivot = selectDialogueLine({ category: "business_pivot", rapportBand: band, registry, random: input.random, fallbackToDeclineFloor: false });
        if (pivot) text = `${text} ${pivot.text}`;
      } else {
        // Business is complete: Claire may actually excuse herself, but only with an authored exit line.
        const exit = selectDialogueLine({ category: "call_exit", rapportBand: band, registry, random: input.random, fallbackToDeclineFloor: false });
        if (exit) {
          text = exit.text;
          endCall = true;
        }
      }
    }
    return {
      text, outcome: "declined", plan, declineId: declineLine.id, failureReason: String(reason),
      fragmentId: details.fragmentId, closedThread: closing, endCall, returnToBusiness, receipt: null,
    };
  };

  if (plan.kind === "decline") {
    return decline(plan.reason, { closeThread: plan.closeThread, fragmentId: plan.eligibleFragmentId, phase: "pre_generation" });
  }

  // --- an answer is authorized: generate, validate, only then reserve/commit ---
  const request: PersonalGenerationRequest = {
    fragment: plan.fragment, plan, rapportBand: band, rung,
    previouslyRefusedTopic: plan.previouslyRefusedTopic,
  };
  let text: string;
  try {
    text = (await input.generate(request)).trim();
  } catch {
    return decline("generation_failed", { closeThread: false, fragmentId: plan.fragment.id, phase: "pre_generation" });
  }
  const failure = validatePersonalAnswer(text, plan.fragment);
  if (failure) {
    return decline(failure, { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
  }

  let receipt: DisclosureReceipt | null = null;
  if (plan.basis === "new_disclosure") {
    const entitlement = context.unusedEntitlement;
    const reservation = entitlement ? await reserveDisclosureEntitlement(input.store, entitlement, now) : null;
    if (!entitlement || !reservation) {
      return decline("reservation_failed", { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
    }
    const commitInput = {
      scope: input.scope, conversationId: input.conversationId, entitlementId: entitlement.id,
      token: reservation.token, fragmentId: plan.fragment.id, topic: input.topic ?? "unknown", rung, rapportBand: band,
    };
    receipt = {
      fragmentId: plan.fragment.id,
      commit: () => commitDisclosure(input.store, commitInput, now),
      abandon: () => abandonDisclosure(input.store, { entitlementId: entitlement.id, token: reservation.token }),
    };
    if (input.autoCommit !== false) {
      await receipt.commit();
      receipt = null;
    }
  } else if (plan.basis === "previously_disclosed") {
    await input.store.appendLedger({
      ...base, kind: "followup_answered", topic: input.topic, fragmentId: plan.fragment.id, entitlementId: null,
      declineId: null, failureReason: null, hadUnusedEntitlement: null, failurePhase: null,
    });
  }

  if (plan.closesThreadAfter) {
    await input.store.appendLedger({
      ...base, kind: "thread_closed", topic: input.topic, fragmentId: null, entitlementId: null,
      declineId: null, failureReason: "budget_spent_after_answer", hadUnusedEntitlement: null, failurePhase: null,
    });
  }

  return {
    text,
    outcome:
      plan.basis === "core" ? "answered_core"
      : plan.basis === "previously_disclosed" ? "answered_previously_disclosed"
      : "answered_new_disclosure",
    plan, declineId: null, failureReason: null, fragmentId: plan.fragment.id,
    closedThread: plan.closesThreadAfter, endCall: false, returnToBusiness: plan.closesThreadAfter && input.businessOpen,
    receipt,
  };
}
