/**
 * Executive retrieval planning.
 *
 * Attention has already decided WHICH compartments may be consulted. This turns that
 * decision into typed retrieval requests. It is still Executive Function: no compartment
 * asks for itself, and nothing here selects a top-level intent or produces a response.
 *
 * When the metric cannot be determined the plan omits the query rather than guessing.
 * An unasked question is recoverable; a confidently wrong reading is not.
 */

import { defaultBusinessQuery, type BusinessMetric, type BusinessQuery } from "../../../analytics/businessQuery";
import type { AttentionPlan } from "../contracts/attention";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { RetrievalRequest } from "../contracts/retrieval";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

const METRIC_PATTERNS: Array<{ metric: BusinessMetric; pattern: RegExp }> = [
  { metric: "latest_sales", pattern: /\b(?:last|latest|recent|most\s+recent)\b[\s\S]{0,20}\b(?:sales?|orders?)\b/i },
  { metric: "biggest_orders", pattern: /\b(?:biggest|largest|top)\b[\s\S]{0,12}\border/i },
  { metric: "open_orders", pattern: /\bopen\s+orders?\b|\boutstanding\b/i },
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

/** Deterministic, explicit, and willing to return null. */
export function inferBusinessMetric(text: string): BusinessMetric | null {
  for (const { metric, pattern } of METRIC_PATTERNS) {
    if (pattern.test(text)) return metric;
  }
  return null;
}

/**
 * Build the query for this turn. Cardinality and ordering come from Perception
 * ("my last five sales" → limit 5), never from a default that silently disagrees
 * with what the operator actually asked for.
 */
export function buildBusinessQuery(perceived: PerceivedTurn): BusinessQuery | null {
  const metric = inferBusinessMetric(perceived.assembledText);
  if (!metric) return null;
  const query = defaultBusinessQuery(metric);
  if (perceived.cardinality && perceived.cardinality > 0) query.limit = perceived.cardinality;
  if (perceived.ordering === "first") query.rank = "earliest";
  const contact = perceived.entities.find(entity => entity.kind === "contact_candidate");
  if (contact) query.customerName = contact.raw;
  if (perceived.listRequest) query.listMembers = true;
  return query;
}

/**
 * Typed retrieval requests for this turn, honouring attention's do-not-retrieve list.
 * A compartment attention excluded is never requested here.
 */
export function planRetrieval(
  perceived: PerceivedTurn,
  memory: WorkingMemorySnapshot,
  attention: AttentionPlan
): RetrievalRequest[] {
  const requests: RetrievalRequest[] = [{ compartment: "workingMemory", kind: "snapshot" }];
  const may = (compartment: RetrievalRequest["compartment"]): boolean =>
    attention.retrieve.includes(compartment) && !attention.doNotRetrieve.includes(compartment);

  if (may("businessMemory")) {
    // A correctness or provenance challenge rechecks the named claim before anything else.
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

    const contact = perceived.entities.find(entity => entity.kind === "contact_candidate");
    if (contact || perceived.businessIntent === "judgment_question") {
      requests.push({
        compartment: "businessMemory",
        kind: "contact_account_resolution",
        contactName: contact?.raw ?? null,
        temporal: perceived.temporalReferences,
      });
      /**
       * "What should I do about Dana Tuesday?" names no metric. A judgment needs the
       * current state of that relationship, so retrieve it directly rather than letting
       * a keyword metric guess — and never search "Dana Tuesday" as a customer name.
       */
      if (perceived.businessIntent === "judgment_question") {
        requests.push({
          compartment: "businessMemory",
          kind: "account_state",
          contactName: contact?.raw ?? null,
          temporal: perceived.temporalReferences,
        });
        requests.push({
          compartment: "businessMemory",
          kind: "open_orders",
          contactName: contact?.raw ?? null,
        });
      }
    }

    // A pure continuation walks memory's resolved result; it must not re-query.
    if (!attention.continueOrderedQuery) {
      const query = buildBusinessQuery(perceived);
      if (query) {
        requests.push({ compartment: "businessMemory", kind: "business_query", query });
      }
    }
  }

  if (may("episodicMemory")) {
    requests.push({
      compartment: "episodicMemory",
      kind: perceived.businessIntent === "judgment_question" ? "prior_actions" : "conversation_history",
      conversationKey: memory.threadId,
    });
  }

  if (may("selfMemory")) {
    requests.push({ compartment: "selfMemory", kind: "disclosure_entitlement" });
  }

  // Goals advise. They are requested only for an unscoped briefing, and always scoped-flagged.
  if (may("goals") && attention.boardEligible) {
    requests.push({ compartment: "goals", kind: "proactive_board_inputs", scoped: false });
  }

  return requests;
}
