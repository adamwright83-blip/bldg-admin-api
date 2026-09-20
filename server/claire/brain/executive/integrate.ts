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
import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import type { EvidenceItem, EvidenceRef, PriorClaimRecheckResult } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { AttentionPlan } from "../contracts/attention";
import type { OrderedQueryMember, WorkingMemorySnapshot } from "../contracts/workingMemory";
import {
  continueOrderedQuery,
  excludeFromThread,
  membersAfterAnchor,
  membersBeforeAnchor,
} from "../workingMemory/orderedQuery";
import type { ResponseSegment } from "../contracts/responsePlan";
import { BUSINESS_ANSWER_UNAVAILABLE, type Conclusion, type InhibitedCandidate } from "../contracts/executiveDecision";

export type IntegrationContext = {
  timeZone: string;
  today: string;
  surface: "voice" | "text";
};

export type IntegrationOutput = {
  segments: ResponseSegment[];
  conclusions: Conclusion[];
  inhibited: InhibitedCandidate[];
  /** Evidence served from working memory rather than a fresh retrieval. */
  extraEvidence: EvidenceItem[];
};

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

export function integrate(input: {
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
      return { segments, conclusions, inhibited, extraEvidence };
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
     * Judgment is a recommendation over evidence, not a factual assertion and never
     * an action. Prose belongs to the character renderer; what the executive fixes
     * here is the evidence the recommendation may stand on and its lack of authority.
     */
    const contact = perceived.entities.find(entity => entity.kind === "contact_candidate");
    const accountItem = evidence.find(item => item.type === "account_state");
    const accountId = accountItem ? ((accountItem.payload as { accountId?: number }).accountId ?? null) : null;
    segments.push({
      type: "BusinessJudgmentSegment",
      text: "",
      evidence: refs(authoritative),
      accountId,
      contactName: contact?.raw ?? null,
      mutationAuthority: false,
    });
    conclusions.push({
      kind: "business_judgment",
      detail: "recommendation is advisory; it carries no mutation authority",
      evidenceIds: authoritative.map(item => item.id),
    });
    return { segments, conclusions, inhibited, extraEvidence };
  }

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

  return { segments, conclusions, inhibited, extraEvidence };
}
