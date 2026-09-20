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
  /**
   * For `synthesized` receipts only: the authoritative receipt whose evidence was supplied to the
   * model. Supplying evidence proves the model SAW it, never that the generated prose is entailed by it.
   */
  supportedBy?: FactualClaimReceipt | null;
  /**
   * For evidence-free model replies: does the statement assert a business fact (true) or is it advice/opinion
   * (false)? Unknown (undefined) until the operator probes it — decided then, by the challenge classifier,
   * so ordinary turns pay no extra model call. Advice is never a factual claim.
   */
  assertsFact?: boolean | null;
};

export const MAX_CLAIM_RECEIPTS = 40;

export type PriorClaimOutcome =
  | "verified"
  /** Original provenance is established, but the value was not re-read, so "still true now" is NOT asserted. */
  | "grounded_as_stated"
  /** Figures and names in a model synthesis trace to authoritative evidence; the framing is the model's own. */
  | "synthesis_grounded"
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
  /** How the challenged receipt was identified. */
  resolvedVia?: "explicit_reference" | "immediately_preceding";
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
  const next = [...(receipts ?? []).filter(existing => existing.id !== receipt.id), receipt];
  // Over the cap, shed the oldest UNGROUNDED receipt first: grounded claims are the ones with truth to protect.
  while (next.length > MAX_CLAIM_RECEIPTS) {
    const victim = next.findIndex(entry => entry.grounding === "ungrounded" && entry.id !== receipt.id);
    next.splice(victim === -1 ? 0 : victim, 1);
  }
  return next;
}

// ── Referent resolution ─────────────────────────────────────────────────────
const COMMON_STARTERS = new Set(["The","This","That","These","Those","There","Their","They","Then","Any","Did","How","What","When","Who","Where","Which","Are","Is","Was","Were","Have","Has","Had","And","But","Okay","Yes","No","Noted","Got","Honestly","Actually","Fair","Right","Sure","Your","You","Our","We","Its","It","Here","Today","Tomorrow","Last","Next","Just","Only","Also","Still","Not","Nothing","Nobody","Someone","Something","Claire","Adam","Goldline","Day","Line","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","January","February","March","April","May","June","July","August","September","October","November","December","CleanCloud","Stripe","Fluff","Fold","Same","Delivery","Card","Order","Orders","One","Two","Three"]);

/** Distinctive referents of a piece of text: named entities and numbers (normalised). */
export function referentTokens(text: string): { names: Set<string>; numbers: Set<string>; money: Set<string> } {
  const names = new Set<string>();
  for (const word of text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []) if (!COMMON_STARTERS.has(word)) names.add(word.toLowerCase());
  const numbers = new Set<string>();
  for (const raw of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) numbers.add(raw.replace(/,/g, ""));
  const money = new Set<string>();
  for (const raw of text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? []) money.add(raw.replace(/[$,\s]/g, ""));
  return { names, numbers, money };
}

function receiptTokens(receipt: FactualClaimReceipt) {
  const tokens = referentTokens(receipt.answerText);
  for (const entry of receipt.evidence) {
    const order = entry.ref?.split(":")[1];
    if (order && /^\d+$/.test(order)) tokens.numbers.add(order);
  }
  return tokens;
}

/** A number is supported by evidence if it is equal, or is the evidence figure rounded to a whole number. */
function numberSupported(n: string, evidence: Set<string>): boolean {
  if (evidence.has(n)) return true;
  const value = Number(n);
  return [...evidence].some(e => Number.isFinite(Number(e)) && (Math.round(Number(e)) === value || Math.floor(Number(e)) === value));
}

export type ClaimResolution =
  | { kind: "resolved"; receipt: FactualClaimReceipt; via: "explicit_reference" | "immediately_preceding" }
  | { kind: "ambiguous"; candidates: FactualClaimReceipt[] }
  | { kind: "none" };

/**
 * Resolve WHICH prior claim the operator is referring to. Deterministic and evidence-free — it only
 * identifies a receipt, never judges it.
 *  - An explicit reference (a name, order number or figure the receipt contains) resolves against ALL
 *    receipts still held in conversation state, however old.
 *  - A bare reaction targets only the immediately preceding Claire turn's claim.
 *  - Two different claims matching equally is ambiguous: fail closed rather than verify an arbitrary one.
 */
export function resolveReferencedClaim(receipts: FactualClaimReceipt[] | undefined, utterance: string, currentClaireTurnOrdinal: number): ClaimResolution {
  const all = receipts ?? [];
  if (!all.length) return { kind: "none" };
  const said = referentTokens(utterance.replace(/(^|[.!?]\s+)([A-Z])/g, (_m, lead: string, c: string) => lead + c));
  const lower = utterance.toLowerCase();
  const scored = all
    .map(receipt => {
      const tokens = receiptTokens(receipt);
      let score = 0;
      for (const name of tokens.names) if (new RegExp(`\\b${name}\\b`).test(lower)) score += 1;
      for (const n of tokens.numbers) if ((n.length >= 3 || n.includes(".")) && said.numbers.has(n)) score += 1;
      return { receipt, score };
    })
    .filter(entry => entry.score > 0);
  if (scored.length) {
    const best = Math.max(...scored.map(entry => entry.score));
    let top = scored.filter(entry => entry.score === best).map(entry => entry.receipt);
    // The same claim stated twice is one referent: take the latest.
    const distinct = new Map<string, FactualClaimReceipt>();
    for (const receipt of top) distinct.set(receipt.fingerprint ?? receipt.id, receipt);
    top = [...distinct.values()];
    return top.length === 1 ? { kind: "resolved", receipt: top[0]!, via: "explicit_reference" } : { kind: "ambiguous", candidates: top };
  }
  const preceding = all.find(receipt => receipt.claireTurnOrdinal === currentClaireTurnOrdinal - 1);
  return preceding ? { kind: "resolved", receipt: preceding, via: "immediately_preceding" } : { kind: "none" };
}

/** Whether the utterance names something a held receipt contains (used to lift the short-utterance gate). */
export function referencesHeldClaim(receipts: FactualClaimReceipt[] | undefined, utterance: string): boolean {
  const said = resolveReferencedClaim(receipts, utterance, -100);
  return said.kind !== "none";
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
  if (receipt.grounding === "ungrounded") {
    return done({ outcome: "unsupported", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
  }

  // A model synthesis is never "verified" merely because evidence was in its prompt. Only its figures and
  // names can be traced to the authoritative evidence; anything beyond that is an unsupported addition.
  if (receipt.grounding === "synthesized") {
    const source = receipt.supportedBy;
    if (!source) return done({ outcome: "unsupported", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
    const claimed = referentTokens(receipt.answerText);
    const backing = receiptTokens(source);
    // A dollar figure must match a DOLLAR figure in the evidence (not a date or a time that happens to share digits).
    const moneyClaimed = [...claimed.money];
    const moneyOk = moneyClaimed.every(m => numberSupported(m, backing.money));
    const plainNumbers = [...claimed.numbers].filter(n => !moneyClaimed.some(m => m === n || m.startsWith(n)));
    const addition = !moneyOk || [...claimed.names].some(name => !backing.names.has(name)) || plainNumbers.some(n => !numberSupported(n, backing.numbers));
    if (addition) return done({ outcome: "unsupported", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
    const underlying = await verifyPriorClaim(source, deps);
    const grounded = underlying.outcome === "verified" || underlying.outcome === "grounded_as_stated";
    return done({
      outcome: grounded ? "synthesis_grounded" : underlying.outcome,
      resolution: underlying.resolution,
      evidenceChanged: underlying.evidenceChanged,
      freshnessAffected: underlying.freshnessAffected,
      timedOut: underlying.timedOut,
    });
  }

  if (receipt.recheck.kind === "none") {
    // Original provenance is established; current truth is not re-read, so it is not asserted.
    return done({ outcome: "grounded_as_stated", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false });
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
  // A re-read from an incomplete source cannot confirm the claim still holds.
  const freshIncomplete = fresh.coverage != null && (fresh.coverage.completeness !== "complete" || fresh.coverage.failedSources.length > 0);
  if (now.fingerprint === receipt.fingerprint && freshIncomplete) {
    return done({ outcome: "grounded_as_stated", resolution: "fresh_query", evidenceChanged: null, freshnessAffected: true, timedOut: false });
  }
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
  const from = sourceWords(v.receipt.supportedBy ?? v.receipt);
  switch (v.outcome) {
    case "verified":
      return `That came from ${from}, and it still checks out.`;
    case "grounded_as_stated":
      return `That came from ${from} when I said it. I can't re-read it right now, so I won't say it still holds.`;
    case "synthesis_grounded":
      return `The figures and names in that came from ${from}. The wording around them was my own read, not a record.`;
    case "superseded":
      return `It was the newest Goldline had when I said it, from ${from}. Something newer has arrived since.`;
    case "stale_source":
      return "That was the newest Goldline had when I said it, but the source was behind. It has moved since.";
    case "changed":
      return "That matched the record when I said it, but the record has changed since. I wouldn't treat the earlier figure as current.";
    case "unsupported":
      return "I didn't have enough to state that as fact.";
    case "unverifiable":
    default:
      return UNVERIFIABLE_SPEECH;
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

/** Spoken when the challenge cannot be tied to exactly one prior claim. Leaves every claim's status untouched. */
export const AMBIGUOUS_REFERENT_SPEECH = "I'm not sure which statement you mean. Name the sale or the number and I'll go from there.";

/** Spoken when a claim cannot be verified in this turn. Status stays unresolved: nothing affirmed, retracted, or confessed. */
export const UNVERIFIABLE_SPEECH = "I can't verify that properly right now.";
