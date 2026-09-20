/**
 * Factual self-provenance for Claire.
 *
 * INVARIANT: models perform adjudicated truth; models do not adjudicate truth.
 *
 * A factual Claire turn leaves a compact `FactualClaimReceipt` describing what
 * was claimed, which authoritative reader produced it, and how (and whether) it
 * can be re-checked. Receipts live in the durable conversation state
 * (`claire_conversation_states.stateJson`) and are mirrored into the existing
 * answer-path telemetry detail — there is no second truth ledger and no schema
 * change.
 *
 * When the operator later challenges a prior claim, `verifyPriorClaim` decides
 * the claim's epistemic status from evidence. Nothing here asks a model whether
 * the earlier answer was true, and a verification that cannot complete leaves
 * the claim UNRESOLVED — it can never become a retraction or a confession.
 * Evidence can be established; intent cannot, so no outcome ever says "lied".
 */
import { createHash } from "node:crypto";
import type { BusinessQuery, BusinessQueryResult } from "../../analytics/businessQuery";

export type ClaimGrounding = "deterministic" | "retrieved" | "synthesized" | "ungrounded";

/** How a receipt can be re-checked against an authoritative reader. */
export type ClaimRecheck = { kind: "business_query"; query: BusinessQuery } | { kind: "none" };

export type FactualClaimReceipt = {
  id: string;
  conversationKey: string;
  /** 1-based count of Claire's spoken turns in this conversation when the claim was made. */
  claireTurnOrdinal: number;
  claimedAtMs: number;
  claimType: string;
  /** The spoken text. Kept so a later turn can quote what was actually said. */
  answerText: string;
  grounding: ClaimGrounding;
  answerPath: string;
  reader: string | null;
  metric: string | null;
  periodLabel: string | null;
  /** Source records / evidence labels supporting the claim, where practical. */
  evidence: Array<{ source: string; ref: string | null }>;
  /** Stable digest of the grounded value; compared on recheck. */
  fingerprint: string | null;
  /** ISO timestamp of the newest grounded record, used to tell "newer data exists". */
  newestRecordAt: string | null;
  asOf: string;
  freshness: { completeness: string | null; loadedSources: string[]; failedSources: string[] } | null;
  recheck: ClaimRecheck;
};

export const MAX_CLAIM_RECEIPTS = 12;
/** A receipt is only "the prior claim" while it is recent; older ones need an explicit reference. */
export const RECENT_CLAIM_TURNS = 4;

export type PriorClaimOutcome =
  | "verified"
  | "superseded"
  | "stale_source"
  | "changed"
  | "unsupported"
  | "unverifiable";

export type PriorClaimResolution = "receipt_only" | "fresh_query" | "not_attempted";

export type PriorClaimVerification = {
  receipt: FactualClaimReceipt;
  outcome: PriorClaimOutcome;
  resolution: PriorClaimResolution;
  evidenceChanged: boolean | null;
  freshnessAffected: boolean;
  timedOut: boolean;
  latencyMs: number;
};

export function claimReceiptDigest(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** Fingerprint + newest-record time for the grounded payload of a business query. */
export function fingerprintBusinessResult(result: BusinessQueryResult): { fingerprint: string | null; newestRecordAt: string | null; refs: Array<string | null> } {
  if (result.status !== "ok") return { fingerprint: null, newestRecordAt: null, refs: [] };
  const data = result.data;
  switch (data.kind) {
    case "orders": {
      const rows = data.orders.map(order => ({ k: order.eventKey, c: order.cents, o: order.orderNumber }));
      const newest = data.orders.map(order => order.occurredAt).sort().pop() ?? null;
      return {
        fingerprint: claimReceiptDigest({ ordering: data.ordering, rows }),
        newestRecordAt: data.ordering === "latest" ? newest : null,
        refs: data.orders.map(order => (order.orderNumber ? `${order.source}:${order.orderNumber}` : order.eventKey)),
      };
    }
    case "totals":
      return { fingerprint: claimReceiptDigest({ t: data.current, p: data.previous }), newestRecordAt: null, refs: [] };
    default:
      return { fingerprint: claimReceiptDigest(data), newestRecordAt: null, refs: [] };
  }
}

const CLAIM_TYPE_BY_METRIC: Record<string, string> = {
  latest_sales: "newest_paid_sale",
  biggest_orders: "largest_paid_order",
  revenue: "paid_revenue",
  orders: "paid_order_count",
  customer_history: "customer_order_history",
  active_customers: "customer_count",
  new_customers: "customer_count",
  dormant_customers: "customer_count",
  open_orders: "open_order_count",
};

export function receiptFromBusinessResult(input: {
  conversationKey: string;
  claireTurnOrdinal: number;
  nowMs: number;
  answerText: string;
  reader: string | null;
  result: BusinessQueryResult;
}): FactualClaimReceipt {
  const { result } = input;
  const grounded = fingerprintBusinessResult(result);
  const coverage = result.status === "ok" ? result.coverage : null;
  const metric = result.query.metric;
  return {
    id: `claim_${input.conversationKey}_${input.claireTurnOrdinal}`,
    conversationKey: input.conversationKey,
    claireTurnOrdinal: input.claireTurnOrdinal,
    claimedAtMs: input.nowMs,
    claimType: CLAIM_TYPE_BY_METRIC[metric] ?? "business_metric",
    answerText: input.answerText,
    grounding: result.status === "ok" ? "deterministic" : "ungrounded",
    answerPath: "business_reader",
    reader: input.reader,
    metric,
    periodLabel: result.period.label,
    evidence: [
      { source: "business_reader:query", ref: metric },
      ...(coverage?.loadedSources ?? []).map(source => ({ source: String(source), ref: null })),
      ...grounded.refs.map(ref => ({ source: "ledger_record", ref })),
    ],
    fingerprint: grounded.fingerprint,
    newestRecordAt: grounded.newestRecordAt,
    asOf: new Date(input.nowMs).toISOString(),
    freshness: coverage
      ? { completeness: coverage.completeness, loadedSources: coverage.loadedSources.map(String), failedSources: coverage.failedSources.map(String) }
      : null,
    recheck: result.status === "ok" ? { kind: "business_query", query: result.query } : { kind: "none" },
  };
}

/** Receipt for a deterministic reader that has no re-runnable query (Day Line, unpaid orders, account history…). */
export function receiptFromReader(input: {
  conversationKey: string;
  claireTurnOrdinal: number;
  nowMs: number;
  answerText: string;
  answerPath: string;
  claimType: string;
  grounding: ClaimGrounding;
  sources: string[];
}): FactualClaimReceipt {
  return {
    id: `claim_${input.conversationKey}_${input.claireTurnOrdinal}`,
    conversationKey: input.conversationKey,
    claireTurnOrdinal: input.claireTurnOrdinal,
    claimedAtMs: input.nowMs,
    claimType: input.claimType,
    answerText: input.answerText,
    grounding: input.grounding,
    answerPath: input.answerPath,
    reader: null,
    metric: null,
    periodLabel: null,
    evidence: input.sources.map(source => ({ source, ref: null })),
    fingerprint: input.grounding === "ungrounded" ? null : claimReceiptDigest(input.answerText),
    newestRecordAt: null,
    asOf: new Date(input.nowMs).toISOString(),
    freshness: null,
    recheck: { kind: "none" },
  };
}

export function appendClaimReceipt(receipts: FactualClaimReceipt[] | undefined, receipt: FactualClaimReceipt): FactualClaimReceipt[] {
  return [...(receipts ?? []).filter(existing => existing.id !== receipt.id), receipt].slice(-MAX_CLAIM_RECEIPTS);
}

/** Most recent claim within the recency window; the referent of a bare "are you sure?". */
export function resolvePriorClaim(receipts: FactualClaimReceipt[] | undefined, currentClaireTurnOrdinal: number): FactualClaimReceipt | null {
  const recent = (receipts ?? []).filter(receipt => currentClaireTurnOrdinal - receipt.claireTurnOrdinal <= RECENT_CLAIM_TURNS);
  return recent[recent.length - 1] ?? null;
}

/** Live-turn budget for a fresh authoritative recheck. */
export const PRIOR_CLAIM_VERIFY_BUDGET_MS = 2500;

export type PriorClaimDeps = {
  rerun: (query: BusinessQuery) => Promise<BusinessQueryResult>;
  budgetMs?: number;
  nowMs?: () => number;
};

const TIMEOUT = Symbol("timeout");

/**
 * Adjudicate a prior claim from evidence. Fails closed: any timeout, throw, or
 * unavailable source yields `unverifiable`, never a retraction.
 */
export async function verifyPriorClaim(receipt: FactualClaimReceipt, deps: PriorClaimDeps): Promise<PriorClaimVerification> {
  const clock = deps.nowMs ?? Date.now;
  const started = clock();
  const done = (partial: Omit<PriorClaimVerification, "receipt" | "latencyMs">): PriorClaimVerification => ({
    receipt,
    latencyMs: clock() - started,
    ...partial,
  });

  // A claim the reader itself never grounded is unsupported on the receipt alone — no requery can rescue it.
  if (receipt.grounding === "ungrounded" || receipt.grounding === "synthesized") {
    return done({ outcome: "unsupported", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
  }

  if (receipt.recheck.kind === "none") {
    // The receipt itself proves the authoritative reader supplied it; there is nothing to requery.
    return done({ outcome: "verified", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
  }

  let fresh: BusinessQueryResult | typeof TIMEOUT;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), deps.budgetMs ?? PRIOR_CLAIM_VERIFY_BUDGET_MS);
    });
    try {
      fresh = await Promise.race([deps.rerun(receipt.recheck.query), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return done({ outcome: "unverifiable", resolution: "not_attempted", evidenceChanged: null, freshnessAffected: false, timedOut: false });
  }
  if (fresh === TIMEOUT) {
    return done({ outcome: "unverifiable", resolution: "not_attempted", evidenceChanged: null, freshnessAffected: false, timedOut: true });
  }
  if (fresh.status !== "ok") {
    return done({ outcome: "unverifiable", resolution: "not_attempted", evidenceChanged: null, freshnessAffected: false, timedOut: false });
  }

  const now = fingerprintBusinessResult(fresh);
  if (now.fingerprint === receipt.fingerprint) {
    return done({ outcome: "verified", resolution: "fresh_query", evidenceChanged: false, freshnessAffected: false, timedOut: false });
  }
  const newer = Boolean(now.newestRecordAt && receipt.newestRecordAt && now.newestRecordAt > receipt.newestRecordAt);
  if (newer) {
    return done({ outcome: "superseded", resolution: "fresh_query", evidenceChanged: true, freshnessAffected: false, timedOut: false });
  }
  const sourceWasBehind =
    (receipt.freshness?.completeness != null && receipt.freshness.completeness !== "complete") || (receipt.freshness?.failedSources.length ?? 0) > 0;
  if (sourceWasBehind) {
    return done({ outcome: "stale_source", resolution: "fresh_query", evidenceChanged: true, freshnessAffected: true, timedOut: false });
  }
  return done({ outcome: "changed", resolution: "fresh_query", evidenceChanged: true, freshnessAffected: false, timedOut: false });
}

function sourceWords(receipt: FactualClaimReceipt): string {
  const record = receipt.evidence.find(entry => entry.source === "ledger_record" && entry.ref);
  if (!record?.ref) return "the ledger";
  const [source, order] = record.ref.split(":");
  const system = /cleancloud/i.test(source ?? "") ? "CleanCloud" : source === "stripe" ? "Stripe" : "the ledger";
  return order ? `${system} order ${order}` : system;
}

/**
 * Restrained, in-character wording chosen by the adjudicated outcome. Deliberately
 * deterministic: verification happens inside a live-turn budget, adds no model
 * hop, and the wording cannot drift from the adjudication. Never says "lied",
 * never speculates about intent, and never claims work will finish later.
 */
export function speakPriorClaimVerification(v: PriorClaimVerification): string {
  const from = sourceWords(v.receipt);
  switch (v.outcome) {
    case "verified":
      return v.receipt.grounding === "retrieved" || v.receipt.claimType === "newest_paid_sale" || v.receipt.claimType === "business_metric"
        ? `No. That came from ${from}, and it still checks out.`
        : "No. That came from your records, and it still checks out.";
    case "superseded":
      return `It was the newest Goldline had when I said it, from ${from}. Something newer has arrived since.`;
    case "stale_source":
      return "That was the newest Goldline had when I said it, but the source was behind. It has moved since.";
    case "changed":
      return "That matched the record when I said it, but the record has changed since. I wouldn't treat the earlier figure as current.";
    case "unsupported":
      return "I didn't have enough to state that as fact. I shouldn't have put it that way.";
    case "unverifiable":
    default:
      return "I can't verify that properly right now.";
  }
}

// ── Defense in depth ─────────────────────────────────────────────────────────
// Primary enforcement is structural (a model turn that touches a prior claim is
// replaced by the adjudicated statement below). This lexical net only decides
// whether a *model-generated* reply appears to be re-characterising a prior
// claim; it never decides the claim's truth.
const STATUS_DOWNGRADE =
  /\b(made (?:that|it|this|him|her|them)? ?up|invented|fabricat\w*|i lied|lying|was lying|i (?:just )?guessed|(?:that was|it was|was) a guess|i (?:was|am) wrong about (?:that|him|her|it)|not (?:actually )?(?:real|true|in cleancloud)|didn'?t (?:actually )?(?:come from|have (?:a|any) (?:record|source|data)))\b/i;

export function modelReplyRewritesPriorClaim(reply: string): boolean {
  return STATUS_DOWNGRADE.test(reply);
}
