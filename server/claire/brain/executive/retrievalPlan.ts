/**
 * Executive retrieval planning, in two passes.
 *
 * The old single pass planned scoped reads before knowing what the named thing WAS,
 * which meant guessing. Now:
 *
 *   PASS A   cheap, unscoped: resolve identity, read the obvious query, fetch the
 *            challenged claim, check disclosure entitlement
 *              ↓
 *   SCOPE    the executive resolves who/what this turn is actually about
 *              ↓
 *   PASS B   scoped: that account's state, that relationship's history, open work,
 *            operations, scoped goals, verification
 *
 * Retrieval CUES are an executive product. The transport knows about Twilio and the
 * desk; it does not get to decide what Claire should try to remember.
 */

import { defaultBusinessQuery, type BusinessMetric, type BusinessQuery } from "../../../analytics/businessQuery";
import type { AttentionPlan } from "../contracts/attention";
import type { EvidenceItem } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { RetrievalRequest } from "../contracts/retrieval";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

const METRIC_PATTERNS: Array<{ metric: BusinessMetric; pattern: RegExp }> = [
  { metric: "latest_sales", pattern: /\b(?:last|latest|recent|most\s+recent)\b[\s\S]{0,20}\b(?:sales?|orders?)\b/i },
  { metric: "biggest_orders", pattern: /\b(?:biggest|largest|top)\b[\s\S]{0,12}\border/i },
  { metric: "open_orders", pattern: /\bopen\s+orders?\b|\boutstanding\b|\bunpaid\b/i },
  { metric: "top_customers", pattern: /\b(?:top|best)\s+customers?\b/i },
  { metric: "frequent_customers", pattern: /\b(?:frequent|repeat|regular)\s+customers?\b/i },
  { metric: "dormant_customers", pattern: /\b(?:dormant|lapsed|lost|stopped)\b[\s\S]{0,16}\bcustomers?\b/i },
  { metric: "new_customers", pattern: /\bnew\s+customers?\b/i },
  { metric: "active_customers", pattern: /\bactive\s+customers?\b/i },
  { metric: "customer_history", pattern: /\b(?:history|last\s+order|ordered)\b/i },
  { metric: "data_freshness", pattern: /\b(?:fresh|up\s+to\s+date|last\s+sync)\b/i },
  { metric: "data_coverage", pattern: /\bcoverage\b|\bwhat\s+(?:data\s+)?(?:do\s+you|can\s+you)\s+see\b/i },
  { metric: "profit", pattern: /\bprofit\b|\bmargin\b/i },
  { metric: "aov", pattern: /\baverage\s+order\b|\baov\b/i },
  { metric: "revenue", pattern: /\brevenue\b|\bsales\b|\bmade\b|\bbrought\s+in\b/i },
  { metric: "orders", pattern: /\borders?\b/i },
];

/** Deterministic, explicit, and willing to return null rather than guess. */
export function inferBusinessMetric(text: string): BusinessMetric | null {
  for (const { metric, pattern } of METRIC_PATTERNS) {
    if (pattern.test(text)) return metric;
  }
  return null;
}

export function buildBusinessQuery(perceived: PerceivedTurn): BusinessQuery | null {
  const metric = inferBusinessMetric(perceived.assembledText);
  if (!metric) return null;
  const query = defaultBusinessQuery(metric);
  if (perceived.cardinality && perceived.cardinality > 0) query.limit = perceived.cardinality;
  if (perceived.ordering === "first") query.rank = "earliest";
  const mentions = perceived.entities.filter(entity => entity.kind === "entity_mention");
  if (mentions.length === 1) query.customerName = mentions[0].raw;
  if (perceived.listRequest) query.listMembers = true;
  return query;
}

/** Is this operations/day-line shaped rather than analytics shaped? */
function wantsOperations(text: string): boolean {
  return /\b(?:today|tomorrow|day\s+line|schedule|route|stops?|what'?s\s+on)\b/i.test(text);
}

/**
 * PASS A — cheap and unscoped. Nothing here needs to know who "Dana" is.
 */
export function planRetrievalPassA(
  perceived: PerceivedTurn,
  memory: WorkingMemorySnapshot,
  attention: AttentionPlan
): RetrievalRequest[] {
  const requests: RetrievalRequest[] = [{ compartment: "workingMemory", kind: "snapshot" }];
  const may = (compartment: RetrievalRequest["compartment"]): boolean =>
    attention.retrieve.includes(compartment) && !attention.doNotRetrieve.includes(compartment);

  if (may("businessMemory")) {
    // The challenged claim comes first: it decides whether anything else is trusted.
    if (attention.priorClaim !== "none") {
      const target = memory.priorClaims[memory.priorClaims.length - 1];
      if (target) {
        requests.push({
          compartment: "businessMemory",
          kind: "prior_claim_recheck",
          receiptId: target.receiptId,
          mode: attention.priorClaim,
        });
      }
    }

    // Identity before anything scoped to it.
    if (attention.entitiesToResolve.length) {
      requests.push({
        compartment: "businessMemory",
        kind: "contact_account_resolution",
        mentions: attention.entitiesToResolve,
        temporal: perceived.temporalReferences,
      });
    }

    // A pure continuation walks memory's resolved result; it must not re-query.
    if (!attention.continueOrderedQuery) {
      if (wantsOperations(perceived.assembledText)) {
        requests.push({ compartment: "businessMemory", kind: "operations" });
      }
      const query = buildBusinessQuery(perceived);
      if (query) requests.push({ compartment: "businessMemory", kind: "business_query", query });
    }
  }

  if (may("selfMemory")) {
    requests.push({ compartment: "selfMemory", kind: "disclosure_entitlement" });
  }

  return requests;
}

/** What Pass A resolved: who this turn is about. */
export type ResolvedScope = {
  accountIds: number[];
  /** Cues for episodic recall, chosen by the executive from resolved identity. */
  terms: string[];
  ambiguous: boolean;
};

/**
 * Read scope out of Pass A's evidence.
 *
 * Terms come from what the rows actually resolved to — the contact's name and its
 * account's name — not from raw speech, so recall is scoped to a real relationship.
 */
export function resolveScope(evidence: readonly EvidenceItem[]): ResolvedScope {
  const accountIds = new Set<number>();
  const terms = new Set<string>();
  let ambiguous = false;

  for (const item of evidence) {
    if (!item.id.startsWith("contact_account_resolution:")) continue;
    const payload = item.payload as {
      resolutionKind?: string;
      mention?: string;
      accountId?: number | null;
      accountName?: string | null;
      contactName?: string | null;
      candidateAccountIds?: number[];
    };
    if (payload.resolutionKind === "ambiguous") ambiguous = true;
    if (payload.accountId != null) accountIds.add(payload.accountId);
    for (const candidate of payload.candidateAccountIds ?? []) accountIds.add(candidate);
    for (const term of [payload.contactName, payload.accountName, payload.mention]) {
      if (term && term.trim().length >= 3) terms.add(term.trim());
    }
  }

  return { accountIds: [...accountIds], terms: [...terms], ambiguous };
}

/**
 * PASS B — scoped to what Pass A resolved.
 *
 * Returns [] when there is nothing new worth asking, which is what lets the control
 * allocator stop rather than loop.
 */
export function planRetrievalPassB(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  attention: AttentionPlan;
  scope: ResolvedScope;
}): RetrievalRequest[] {
  const { attention, scope } = input;
  const requests: RetrievalRequest[] = [];
  const may = (compartment: RetrievalRequest["compartment"]): boolean =>
    attention.retrieve.includes(compartment) && !attention.doNotRetrieve.includes(compartment);
  const kinds = new Set(attention.activeTaskSets.map(set => set.kind));

  // Ambiguous identity is a question for the operator; more reading cannot fix it.
  if (scope.ambiguous) return requests;

  if (may("businessMemory") && scope.accountIds.length) {
    for (const accountId of scope.accountIds.slice(0, 2)) {
      requests.push({ compartment: "businessMemory", kind: "account_state", accountId });
    }
    if (kinds.has("account_judgment")) {
      requests.push({ compartment: "businessMemory", kind: "open_orders", accountId: scope.accountIds[0] });
    }
  }

  // Episodic recall, cued by resolved identity rather than by the transport.
  if (may("episodicMemory") && scope.terms.length) {
    requests.push({
      compartment: "episodicMemory",
      kind: kinds.has("account_judgment") ? "prior_actions" : "conversation_history",
      accountId: scope.accountIds[0] ?? null,
      terms: scope.terms,
    });
  }

  // Goals only for an unscoped briefing.
  if (may("goals") && attention.boardEligible) {
    requests.push({ compartment: "goals", kind: "proactive_board_inputs", scoped: false });
  }

  return requests;
}

/** A verification round: re-read the challenged claim against the source. */
export function planVerification(
  memory: WorkingMemorySnapshot,
  attention: AttentionPlan
): RetrievalRequest[] {
  if (attention.priorClaim === "none") return [];
  const target = memory.priorClaims[memory.priorClaims.length - 1];
  if (!target || !target.recheckable) return [];
  return [
    {
      compartment: "businessMemory",
      kind: "prior_claim_recheck",
      receiptId: target.receiptId,
      mode: "correctness",
    },
  ];
}
