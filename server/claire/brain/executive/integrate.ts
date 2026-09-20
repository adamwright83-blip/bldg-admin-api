/**
 * Executive integration and inhibition.
 *
 * Takes the evidence the compartments returned and decides what Claire may assert.
 * This is the only place a business claim becomes a renderable segment, and every
 * such segment carries the evidence that licensed it.
 *
 * Inhibition is explicit: an invalid cognitive leap is recorded as an inhibited
 * candidate rather than silently dropped, so a shadow comparison can show WHY the
 * two minds disagreed.
 */

import { joinList, speakBusinessResult } from "../../business/businessSpeech";
import { businessQueryFingerprint, resolvedMembers } from "../businessMemory/evidence";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import type { EvidenceItem, EvidenceRef, PriorClaimRecheckResult } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { AttentionPlan } from "../contracts/attention";
import type { OrderedQueryMember, OrderedQueryMemory, WorkingMemorySnapshot } from "../contracts/workingMemory";
import {
  continueOrderedQuery,
  excludeFromThread,
  membersAfterAnchor,
  membersBeforeAnchor,
} from "../workingMemory/orderedQuery";
import type { ResponseSegment } from "../contracts/responsePlan";
import { BUSINESS_ANSWER_UNAVAILABLE, type Conclusion, type InhibitedCandidate } from "../contracts/executiveDecision";
import { buildJudgmentBrief, recommendOverEvidence, type JudgmentRecommender } from "./judgment";
import { mintPersonalDisclosureGrant } from "./grants";

export type IntegrationContext = {
  timeZone: string;
  today: string;
  surface: "voice" | "text";
  /**
   * Optional model-assisted reasoning for business judgment. It may reason over the
   * supplied evidence; `assertJudgmentGrounded` rejects anything it invents.
   */
  recommend?: JudgmentRecommender;
};

/**
 * What this turn resolved and what it actually told the operator.
 *
 * RESOLVED is the whole result the reader returned. PRESENTED is only what Claire
 * said out loud. Keeping them apart is what makes "the other four" answerable later,
 * so the executive records it here rather than leaving a caller to guess from prose.
 */
export type OrderedQueryUpdate = {
  queryFingerprint: string;
  parameters: unknown;
  requestedCardinality: number | null;
  ordering: OrderedQueryMemory["ordering"];
  anchorEntity: string | null;
  resolved: OrderedQueryMember[];
  presented: OrderedQueryMember[];
  sourceEvidence: EvidenceItem;
};

export type IntegrationOutput = {
  segments: ResponseSegment[];
  conclusions: Conclusion[];
  inhibited: InhibitedCandidate[];
  /** Evidence served from working memory rather than a fresh retrieval. */
  extraEvidence: EvidenceItem[];
  /** Set when this turn opened or advanced an ordered result. */
  orderedQueryUpdate?: OrderedQueryUpdate;
  /** Members presented while continuing an existing result. */
  continuationPresented?: OrderedQueryMember[];
};

/** A member counts as presented only when Claire actually named it. */
function presentedFrom(members: readonly OrderedQueryMember[], spoken: string): OrderedQueryMember[] {
  const haystack = spoken.toLowerCase();
  return members.filter(member => {
    const label = member.label?.trim().toLowerCase();
    return Boolean(label && label.length >= 2 && haystack.includes(label));
  });
}

/**
 * Serve a continuation from the resolved result already in working memory.
 *
 * This is the whole point of separating `resolved` from `presented`: the operator is
 * asking for more of the SAME answer, so re-querying would silently hand them a
 * different set of records. The claim cites the original evidence and therefore
 * carries the original as-of time.
 */
function continueFromMemory(
  perceived: PerceivedTurn,
  memory: WorkingMemorySnapshot
): { members: OrderedQueryMember[]; source: EvidenceItem | null } | null {
  const stored = memory.orderedQuery;
  if (!stored) return null;
  const scoped = perceived.exclusions.length ? excludeFromThread(stored, perceived.exclusions) : stored;
  if (perceived.anchorEntity && perceived.ordering === "before_anchor") {
    return { members: membersBeforeAnchor(scoped, perceived.anchorEntity), source: scoped.sourceEvidence };
  }
  if (perceived.anchorEntity && perceived.ordering === "after_anchor") {
    return { members: membersAfterAnchor(scoped, perceived.anchorEntity), source: scoped.sourceEvidence };
  }
  return { members: continueOrderedQuery(scoped, perceived.cardinality).members, source: scoped.sourceEvidence };
}

function refs(items: EvidenceItem[]): EvidenceRef[] {
  return items.map(item => ({ evidenceId: item.id }));
}

const BUSINESS_TRUTH_TYPES = new Set([
  "business_query",
  "account_state",
  "open_orders",
  "operations",
  "day_line_read",
  "field_today",
  "prior_claim_recheck",
]);

/** Any evidence that genuinely speaks for current truth. A judgment may reason over all of it. */
function authoritativeBusiness(evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.filter(
    item =>
      BUSINESS_TRUTH_TYPES.has(item.type) &&
      item.operatorVisible &&
      item.authoritativeFor.includes("current_business_truth")
  );
}

/**
 * Only a business_query result carries a deterministic speaker. Other authoritative
 * evidence can inform a judgment but must not be improvised into a spoken fact.
 */
function speakableResults(evidence: EvidenceItem[]): EvidenceItem[] {
  return authoritativeBusiness(evidence).filter(item => item.type === "business_query");
}

function recheckFrom(evidence: EvidenceItem[]): PriorClaimRecheckResult | null {
  const item = evidence.find(candidate => candidate.type === "prior_claim_recheck");
  if (!item) return null;
  const payload = item.payload as { recheck?: PriorClaimRecheckResult } | null;
  return payload?.recheck ?? null;
}

/**
 * Deterministic speech for a resolved business result, reusing the existing speaker.
 * The brain does not compose numbers of its own — if the reader did not say it,
 * it does not get spoken.
 */
function speakResult(item: EvidenceItem, perceived: PerceivedTurn, ctx: IntegrationContext): string {
  const result = item.payload as BusinessQueryResult;
  try {
    return speakBusinessResult(result, {
      surface: ctx.surface,
      previous: null,
      refinement: false,
      utterance: perceived.assembledText,
      today: ctx.today,
      disclosed: [],
      timeZone: ctx.timeZone,
    }).text;
  } catch {
    // Fail closed: a speaker error yields no claim, never a half-stated number.
    return "";
  }
}

function integrateBusiness(input: {
  perceived: PerceivedTurn;
  attention: AttentionPlan;
  evidence: EvidenceItem[];
  memory: WorkingMemorySnapshot;
  ctx: IntegrationContext;
}): IntegrationOutput {
  const { perceived, attention, evidence, memory, ctx } = input;
  const segments: ResponseSegment[] = [];
  const conclusions: Conclusion[] = [];
  const inhibited: InhibitedCandidate[] = [];
  const extraEvidence: EvidenceItem[] = [];

  // History may establish "X was recorded then". It may never become current truth.
  for (const item of evidence) {
    if (item.type === "conversation_turn" && item.authoritativeFor.includes("current_business_truth")) {
      inhibited.push({
        kind: "episodic_as_current_truth",
        detail: `episodic item ${item.id} claimed current business truth`,
      });
    }
  }

  const businessLane = attention.lanes.includes("business");
  if (!businessLane) return { segments, conclusions, inhibited, extraEvidence };

  if (attention.continueOrderedQuery) {
    const continuation = continueFromMemory(perceived, memory);
    const source = continuation?.source ?? null;
    if (continuation && continuation.members.length > 0 && source?.authoritativeFor.includes("current_business_truth")) {
      extraEvidence.push(source);
      segments.push({
        type: "BusinessFactSegment",
        text: joinList(continuation.members.map(member => member.label ?? member.id)) + ".",
        evidence: [{ evidenceId: source.id }],
        origin: "authoritative_reader",
      });
      conclusions.push({
        kind: "ordered_query_continuation",
        detail: "served from the resolved result already in working memory; no new query was issued",
        evidenceIds: [source.id],
      });
      return { segments, conclusions, inhibited, extraEvidence, continuationPresented: continuation.members };
    }
    conclusions.push({
      kind: BUSINESS_ANSWER_UNAVAILABLE,
      detail: "nothing remains in the resolved result to continue",
      evidenceIds: source ? [source.id] : [],
    });
    return { segments, conclusions, inhibited, extraEvidence };
  }

  const authoritative = authoritativeBusiness(evidence);
  const recheck = recheckFrom(evidence);

  // A correctness challenge that could not be freshly reread must not be answered
  // from the old receipt as though it were still true.
  if (attention.priorClaim === "correctness" && recheck && recheck.resolution !== "fresh_query") {
    inhibited.push({
      kind: "stale_receipt_as_fresh_proof",
      detail: `receipt ${recheck.receiptId} could not be rechecked (${recheck.outcome})`,
    });
  }

  if (authoritative.length === 0) {
    conclusions.push({
      kind: BUSINESS_ANSWER_UNAVAILABLE,
      detail:
        attention.continueOrderedQuery
          ? "continuation is served from working memory, not a new authoritative read"
          : "no authoritative current-business-truth evidence was retrieved for this turn",
      evidenceIds: evidence.map(item => item.id),
    });
    return { segments, conclusions, inhibited, extraEvidence };
  }

  if (perceived.businessIntent === "judgment_question") {
    /**
     * Judgment integrates current authoritative state with what happened before and
     * with scoped priorities, then recommends a next move. It is advisory: it asserts
     * no new fact and carries no mutation authority.
     *
     * History and goals participate in the REASONING but never in the authority —
     * they cannot make something currently true, and the evidence stamps keep that
     * separation intact through the governor.
     */
    const brief = buildJudgmentBrief({ evidence, temporal: perceived.temporalReferences });
    const recommendation = recommendOverEvidence(brief, ctx.recommend);

    if (brief.history.length) {
      inhibited.push({
        kind: "episodic_as_current_truth",
        detail: "history informed the recommendation but was not promoted to current truth",
      });
    }

    segments.push({
      type: "BusinessJudgmentSegment",
      text: recommendation.text,
      // The judgment stands on current authoritative evidence; history and goals are
      // cited too so the operator can see everything that shaped the recommendation.
      evidence: refs([...authoritative, ...brief.history, ...brief.goals]),
      accountId: brief.subject?.accountId ?? null,
      contactName: brief.subject?.contactName ?? brief.subject?.mention ?? null,
      mutationAuthority: false,
    });
    conclusions.push({
      kind: "business_judgment",
      detail: `recommendation is advisory (${recommendation.source}); it carries no mutation authority`,
      evidenceIds: [...authoritative, ...brief.history, ...brief.goals].map(item => item.id),
    });
    return { segments, conclusions, inhibited, extraEvidence };
  }

  let orderedQueryUpdate: OrderedQueryUpdate | undefined;
  for (const item of speakableResults(evidence)) {
    const text = speakResult(item, perceived, ctx);
    if (!text) continue;
    const segment: ResponseSegment = {
      type: "BusinessFactSegment",
      text,
      evidence: refs([item]),
      origin: "authoritative_reader",
      ...(recheck ? { recheck } : {}),
    };
    segments.push(segment);

    // Remember the whole result and the part actually spoken, so a later
    // "the other four" walks this same result instead of re-querying.
    const result = item.payload as Parameters<typeof resolvedMembers>[0];
    const members = resolvedMembers(result);
    if (members.length && !orderedQueryUpdate) {
      orderedQueryUpdate = {
        queryFingerprint: `${result.query.metric}:${businessQueryFingerprint(result)}`,
        parameters: result.query,
        requestedCardinality: perceived.cardinality,
        ordering: perceived.ordering,
        anchorEntity: perceived.anchorEntity,
        resolved: members,
        presented: presentedFrom(members, text),
        sourceEvidence: item,
      };
    }
  }

  if (segments.length === 0) {
    conclusions.push({
      kind: BUSINESS_ANSWER_UNAVAILABLE,
      detail: "authoritative evidence was retrieved but produced no speakable claim",
      evidenceIds: authoritative.map(item => item.id),
    });
  } else {
    conclusions.push({
      kind: "business_fact",
      detail: "claim is licensed by authoritative current-business-truth evidence",
      evidenceIds: authoritative.map(item => item.id),
    });
  }

  return { segments, conclusions, inhibited, extraEvidence, orderedQueryUpdate };
}


/**
 * Personal / narrative lane.
 *
 * Self Memory reports what the operator is ENTITLED to; it never decides to speak.
 * Executive Function mints the disclosure grant here, and only when an entitlement
 * is actually on record. With no entitlement, Claire declines lawfully — which is a
 * real answer, not a failure, and is deliberately a plain conversational segment
 * because a decline carries no disclosure authority.
 *
 * This lane can never suppress a business answer. It only ever appends.
 */
function integratePersonal(input: {
  perceived: PerceivedTurn;
  attention: AttentionPlan;
  evidence: EvidenceItem[];
}): IntegrationOutput {
  const { perceived, attention, evidence } = input;
  const segments: ResponseSegment[] = [];
  const conclusions: Conclusion[] = [];
  const inhibited: InhibitedCandidate[] = [];

  const personalLane = attention.lanes.includes("personal") || attention.lanes.includes("narrative");
  if (!personalLane) return { segments, conclusions, inhibited, extraEvidence: [] };

  const entitlement = evidence.find(item => item.type === "disclosure_entitlement");
  if (entitlement) {
    const entitlementId = (entitlement.payload as { entitlementId?: string }).entitlementId ?? entitlement.id;
    const grant = mintPersonalDisclosureGrant({
      entitlementId,
      basis: "progression_entitlement",
      rung: null,
    });
    segments.push({
      type: "PersonalDisclosureSegment",
      // Authored content belongs to the canon/dialogue registry, not to generation here.
      // The executive authorises the disclosure; it does not write Claire's biography.
      text: "",
      grant,
    });
    conclusions.push({
      kind: "personal_disclosure_authorised",
      detail: `entitlement ${entitlementId} permits one disclosure`,
      evidenceIds: [entitlement.id],
    });
    return { segments, conclusions, inhibited, extraEvidence: [] };
  }

  // Fail closed, and say so plainly rather than inventing biography.
  segments.push({
    type: "ConversationalSegment",
    text: perceived.narrativeProbe ? "That's not something I'm going to get into." : "Not something I'm getting into.",
  });
  conclusions.push({
    kind: "personal_disclosure_declined",
    detail: "no disclosure entitlement on record; declined without disclosing",
    evidenceIds: [],
  });
  return { segments, conclusions, inhibited, extraEvidence: [] };
}

/**
 * Integrate every attended lane into one set of segments.
 *
 * Business runs first and personal is appended, so a personal lane can never consume,
 * reorder away, or short-circuit the business answer. The governor independently
 * re-checks that property.
 */
export function integrate(input: {
  perceived: PerceivedTurn;
  attention: AttentionPlan;
  evidence: EvidenceItem[];
  memory: WorkingMemorySnapshot;
  ctx: IntegrationContext;
}): IntegrationOutput {
  const business = integrateBusiness(input);
  const personal = integratePersonal({
    perceived: input.perceived,
    attention: input.attention,
    evidence: input.evidence,
  });
  return {
    segments: [...business.segments, ...personal.segments],
    conclusions: [...business.conclusions, ...personal.conclusions],
    inhibited: [...business.inhibited, ...personal.inhibited],
    extraEvidence: [...business.extraEvidence, ...personal.extraEvidence],
    orderedQueryUpdate: business.orderedQueryUpdate,
    continuationPresented: business.continuationPresented,
  };
}
