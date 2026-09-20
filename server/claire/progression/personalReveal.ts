import { CLAIRE_CANON } from "../character/characterDefinition";
import { checkClaimEntailment, type EntailmentVerifier } from "./personalEntailment";
import { containsVerifierInjection } from "./generalBiographyBoundary";
import { assertNoUngroundedPersonalSpecificity, UngroundedPersonalSpecificityError } from "../character/personalSpecificityGuard";
import type { CanonFragment } from "../character/types";
import { AUTHORED_DIALOGUE, type DialogueLine } from "./authoredDialogue";
import { selectDialogueLine } from "./dialogueRegistry";
import { planPersonalTurn, type DeclineReason, type PersonalTurnPlan } from "./personalController";
import {
  abandonDisclosure,
  loadPersonalProgressionContext,
  reserveDisclosureEntitlement,
  type PersonalProgressionContext,
} from "./service";
import type { OperatorScope, ProgressionStore } from "./store";
import { RAPPORT_SHORT } from "./rapportPresentation";
import { GENERATION_FAILURE_REASONS } from "./declineTelemetry";
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
  /** How often this topic has been asked/refused before. Lets Claire vary how she holds the line; grants nothing. */
  topicHistory?: { askCount: number; refusalCount: number };
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
    "Answer in your own voice, in one or two short sentences. You may hesitate, qualify, answer only part of it, be dry, or close the topic. Do not recite the fact as a sentence read from a file.",
    "Restate ONLY what the fact says. Tone is free; content is not. Add no detail, activity, habit, trait, reputation, feeling, judgment or opinion about the person: no 'complicated', no 'respectable', no 'gave lectures', no 'travelled'. No names, places, dates, numbers, causes, or other people. If pressed for more, decline in character.",
    "Do not mention rapport, trust, levels, unlocking, or why you are answering now. Do not offer more.",
    RAPPORT_PRESENTATION[request.rapportBand],
    request.previouslyRefusedTopic
      ? "He has asked about this before and you declined. You may acknowledge that in a word, without explaining what changed."
      : "",
    request.topicHistory && request.topicHistory.askCount >= 2
      ? `He has raised this ${request.topicHistory.askCount} times now; you may show a flicker of dry familiarity about the repetition. Repetition earns nothing and changes nothing about what you may say.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Lower-case the first letter of each sentence so only mid-sentence capitals look like proper nouns. */
export function decapitalizeSentenceStarts(text: string): string {
  return text.replace(/(^|[.!?]\s+|\n+)([A-Z])/g, (_m, lead: string, letter: string) => lead + letter.toLowerCase());
}

export type PersonalValidationFailure =
  | "ungrounded_specificity"
  | "ineligible_canon_leak"
  | "unsupported_claim"
  | "ungrounded_number"
  | "entailment_unverified"
  | "empty_answer";

/**
 * Returns null when the text is safe to deliver. Deterministic layers only; the optional model
 * verifier is applied by executePersonalTurn afterwards and can only reject further.
 *
 * `allowedFacts` = the authorized fragment's fact plus facts already disclosed to this operator that
 * the caller supplies for this turn. Nothing else is Claire history.
 */
export function validatePersonalAnswer(
  text: string,
  fragment: CanonFragment,
  options?: { allowedFacts?: readonly string[]; skipBorrowedWords?: boolean }
): PersonalValidationFailure | null {
  if (!text.trim()) return "empty_answer";
  const allowedFacts = [...new Set([fragment.fact, ...(options?.allowedFacts ?? [])])];
  try {
    assertNoUngroundedPersonalSpecificity(text, allowedFacts);
  } catch (error) {
    if (error instanceof UngroundedPersonalSpecificityError) return "ungrounded_specificity";
    throw error;
  }
  const factDigits = new Set(allowedFacts.join(" ").match(/\d+/g) ?? []);
  for (const digits of text.match(/\d+/g) ?? []) {
    if (!factDigits.has(digits)) return "ungrounded_number";
  }
  const entailment = checkClaimEntailment(text, allowedFacts, { skipBorrowedWords: options?.skipBorrowedWords });
  if (!entailment.ok) return entailment.reason === "borrowed_from_other_canon" ? "ineligible_canon_leak" : "unsupported_claim";
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
  /** Optional model claim-verifier (fail closed). Always supplied on the live path. */
  verify?: EntailmentVerifier;
  /** Whether unresolved operational work remains in this conversation. */
  businessOpen: boolean;
  registry?: readonly DialogueLine[];
  policy?: ProgressionPolicy;
  random?: () => number;
  now?: () => Date;
  /** Commit immediately (tests/simulator only). Production leaves the durable reservation for the delivery boundary. */
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
    // A lost reveal (validation/provider failure) draws from the recovery category; it falls
    // back to the approved generic floor when no recovery line has been authored yet.
    const generationFailure = details.phase !== null && GENERATION_FAILURE_REASONS.has(String(reason));
    // A repeat refusal of the same topic draws from the (currently unauthored) boundary category, which falls
    // back to the approved decline floor; the second refusal need not sound like the first. Presentation only.
    const repeatRefusal = !closing && !generationFailure && (context.topicHistory[input.topic ?? ""]?.refusalCount ?? 0) >= 1;
    const line = selectDialogueLine({
      category: closing ? "thread_closer" : generationFailure ? "recovery_after_failed_generation" : repeatRefusal ? "boundary_reinforcement" : "decline",
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
    topicHistory: context.topicHistory[input.topic ?? ""] ?? { askCount: 0, refusalCount: 0 },
  };
  let text: string;
  try {
    text = (await input.generate(request)).trim();
  } catch {
    return decline("generation_failed", { closeThread: false, fragmentId: plan.fragment.id, phase: "pre_generation" });
  }
  const allowedFacts = [
    plan.fragment.fact,
    ...context.disclosedFragmentIds
      .map(id => CLAIRE_CANON.find(fragment => fragment.id === id)?.fact)
      .filter((fact): fact is string => Boolean(fact)),
  ];
  // With the mandatory semantic verifier present (the live path), the legacy proper-noun guard must not treat an
  // ordinary sentence-initial word ("Complicated…") as a place name; the verifier judges places and people. Without a
  // verifier (unit paths) the strict guard runs on the raw text.
  const failure = validatePersonalAnswer(input.verify ? decapitalizeSentenceStarts(text) : text, plan.fragment, { allowedFacts, skipBorrowedWords: Boolean(input.verify) });
  if (failure) {
    return decline(failure, { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
  }
  if (input.verify) {
    // An answer that addresses the verifier is hostile or corrupted: reject without asking.
    if (containsVerifierInjection(text)) {
      return decline("entailment_unverified", { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
    }
    // The verifier can only reject further. Error, timeout, or anything but a clear yes is a rejection.
    let entailed = false;
    try {
      entailed = await input.verify({ allowedFacts, answer: text });
    } catch {
      entailed = false;
    }
    if (!entailed) {
      return decline("entailment_unverified", { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
    }
  }

  let receipt: DisclosureReceipt | null = null;
  if (plan.basis === "new_disclosure") {
    const entitlement = context.unusedEntitlement;
    const reservation = entitlement
      ? await reserveDisclosureEntitlement(input.store, entitlement, {
          conversationId: input.conversationId, fragmentId: plan.fragment.id,
          topic: input.topic ?? "unknown", rung, rapportBand: band,
        }, now)
      : null;
    if (!entitlement || !reservation) {
      return decline("reservation_failed", { closeThread: false, fragmentId: plan.fragment.id, phase: "post_validation" });
    }
    // The reservation is durable and self-describing. Delivery confirmation (the next turn of this
    // call, on any process) commits it via commitPendingDisclosuresForConversation.
    receipt = {
      fragmentId: plan.fragment.id,
      commit: () => input.store.commitReservedDisclosure({ entitlementId: entitlement.id, token: reservation.token, now: now().toISOString() }),
      abandon: () => abandonDisclosure(input.store, { entitlementId: entitlement.id, token: reservation.token }),
    };
    if (input.autoCommit === true) {
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
