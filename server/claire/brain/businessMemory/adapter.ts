/**
 * Business Memory adapter — read-only.
 *
 * Every typed request maps to an EXISTING authoritative reader, or is explicitly
 * unsupported. Nothing here reimplements query logic and nothing here mutates.
 *
 * `[]` means "we did not retrieve", never "there is nothing". Executive Function is
 * responsible for not turning an empty bundle into a spoken zero, and
 * `UNSUPPORTED_REQUEST` exists so an unimplemented capability is visibly unsupported
 * rather than silently indistinguishable from an empty result.
 *
 * Readers are injected so brain tests run without a database.
 */

import {
  defaultBusinessQueryDeps,
  runBusinessQuery,
  type BusinessQuery,
  type BusinessQueryResult,
} from "../../../analytics/businessQuery";
import {
  listAccountContacts,
  listAccountRefs,
  loadAccountHistory,
  matchAccounts,
  type AccountContactRef,
  type AccountHistory,
  type AccountRef,
} from "../../knowledge/accountKnowledge";
import { loadUnpaidOrders, type UnpaidOrder } from "../../knowledge/openOrdersKnowledge";
import { loadDayWork, type DayWork } from "../../knowledge/operationsKnowledge";
import {
  verifyPriorClaim,
  type FactualClaimReceipt,
  type PriorClaimVerification,
} from "../../provenance/claimReceipts";
import type { BusinessRetrievalRequest, PriorClaimRecheckRequest } from "../contracts/retrieval";
import type { EvidenceItem, PriorClaimRecheckResult } from "../contracts/evidence";
import { evidenceFromAccountRef, evidenceFromBusinessResult, evidenceFromResolution } from "./evidence";
import { evidenceFromAccountHistory } from "./accountEvidence";
import { resolveEntityMentions } from "./entityResolution";
import { admitsToOperatorEvidence } from "./sourceProvenance";

export type BusinessMemoryContext = {
  tenantId: string;
  operatorUserId: string;
  /** Day Director keys commitments by a numeric actor id, not the openId. */
  dayDirectorActorId?: string;
  nowIso: string;
  businessDate?: string;
  timeZone?: string;
  priorClaimReceipts?: FactualClaimReceipt[];
};

export type BusinessMemoryDeps = {
  runQuery: (tenantId: string, query: BusinessQuery) => Promise<BusinessQueryResult>;
  listAccounts: (tenantId: string) => Promise<AccountRef[]>;
  listContacts: (tenantId: string) => Promise<AccountContactRef[]>;
  loadHistory: (input: { tenantId: string; operatorUserId: string; account: AccountRef }) => Promise<AccountHistory>;
  loadOpenOrders: (tenantId: string) => Promise<UnpaidOrder[]>;
  loadOperations: (input: {
    tenantId: string;
    operatorUserId: string;
    dayDirectorActorId: string;
    businessDate: string;
    now: Date;
    timeZone: string;
  }) => Promise<DayWork>;
  /** The tenant is passed in; it is never assumed. */
  verifyClaim: (receipt: FactualClaimReceipt, tenantId: string) => Promise<PriorClaimVerification>;
};

export const defaultBusinessMemoryDeps: BusinessMemoryDeps = {
  runQuery: (tenantId, query) => runBusinessQuery(tenantId, query),
  listAccounts: tenantId => listAccountRefs(tenantId),
  listContacts: tenantId => listAccountContacts(tenantId),
  loadHistory: input => loadAccountHistory(input),
  loadOpenOrders: tenantId => loadUnpaidOrders(tenantId),
  loadOperations: input => loadDayWork(input),
  verifyClaim: (receipt, tenantId) =>
    // The rechecked query must run against the SAME tenant that made the claim.
    verifyPriorClaim(receipt, {
      rerun: query => runBusinessQuery(tenantId, query, defaultBusinessQueryDeps),
    }),
};

/** Marks a capability that has no reader yet, so it cannot be mistaken for "none". */
export const UNSUPPORTED_REQUEST = "unsupported_request" as const;

function operatorVisible(item: EvidenceItem): boolean {
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  return item.operatorVisible && admitsToOperatorEvidence({ ...item.provenance, ...payload });
}

/** The synthetic firewall. Nothing reaches Executive Function without passing here. */
export function admitBusinessEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter(item => operatorVisible(item));
}

function isBusinessQueryRequest(
  request: BusinessRetrievalRequest | PriorClaimRecheckRequest
): request is BusinessRetrievalRequest {
  return request.kind !== "prior_claim_recheck";
}

export function recheckResultFromVerification(verification: PriorClaimVerification): PriorClaimRecheckResult {
  return {
    receiptId: verification.receipt.id,
    resolution: verification.resolution,
    outcome: verification.outcome,
    evidenceIds: verification.receipt.evidence.map(item => item.ref ?? item.source),
  };
}

/**
 * Re-adjudicate a prior claim.
 *
 * "Where did that come from?" is answered from the receipt. "Are you sure?" performs a
 * genuine reread — and only that reread may speak for current truth. The receipt says
 * WHAT to recheck; it is never itself proof the claim still holds. Fails closed.
 */
export async function recheckPriorClaim(
  request: PriorClaimRecheckRequest,
  ctx: BusinessMemoryContext,
  deps: BusinessMemoryDeps = defaultBusinessMemoryDeps
): Promise<{ recheck: PriorClaimRecheckResult; evidence: EvidenceItem[] } | null> {
  const receipt = (ctx.priorClaimReceipts ?? []).find(item => item.id === request.receiptId);
  if (!receipt) return null;

  if (request.mode === "provenance") {
    const evidence: EvidenceItem = {
      id: `claim_receipt:${receipt.id}`,
      type: "claim_receipt",
      source: receipt.reader ?? receipt.answerPath,
      provenance: { reader: receipt.reader ?? receipt.answerPath },
      observedAt: ctx.nowIso,
      asOf: receipt.asOf,
      freshness: receipt.freshness ?? null,
      coverage: null,
      authoritativeFor: ["provenance_receipt"],
      payload: {
        receiptId: receipt.id,
        metric: receipt.metric,
        periodLabel: receipt.periodLabel,
        grounding: receipt.grounding,
        evidence: receipt.evidence,
      },
      operatorVisible: true,
    };
    return {
      recheck: { receiptId: receipt.id, resolution: "receipt_only", outcome: "grounded_as_stated", evidenceIds: [] },
      evidence: admitBusinessEvidence([evidence]),
    };
  }

  const verification = await deps.verifyClaim(receipt, ctx.tenantId);
  const recheck = recheckResultFromVerification(verification);
  const evidence: EvidenceItem = {
    id: `prior_claim_recheck:${receipt.id}`,
    type: "prior_claim_recheck",
    source: receipt.reader ?? receipt.answerPath,
    provenance: { reader: receipt.reader ?? receipt.answerPath },
    observedAt: ctx.nowIso,
    asOf: ctx.nowIso,
    freshness: receipt.freshness ?? null,
    coverage: null,
    authoritativeFor: recheck.resolution === "fresh_query" ? ["current_business_truth"] : ["provenance_receipt"],
    payload: { recheck, receiptId: receipt.id, timedOut: verification.timedOut },
    operatorVisible: true,
  };
  return { recheck, evidence: admitBusinessEvidence([evidence]) };
}

/** Accounts this request is scoped to, resolved from mentions or given directly. */
async function scopedAccounts(
  request: BusinessRetrievalRequest,
  ctx: BusinessMemoryContext,
  deps: BusinessMemoryDeps
): Promise<AccountRef[]> {
  const accounts = (await deps.listAccounts(ctx.tenantId)).filter(account => admitsToOperatorEvidence(account));
  if (request.accountId != null) return accounts.filter(account => account.id === request.accountId);

  const mentions = request.mentions ?? (request.contactName ? [request.contactName] : []);
  if (!mentions.length) return [];

  const contacts = (await deps.listContacts(ctx.tenantId)).filter(contact =>
    admitsToOperatorEvidence({ name: contact.accountName, accountType: contact.accountType })
  );
  const resolutions = resolveEntityMentions(mentions, accounts, contacts);
  const ids = new Set(resolutions.flatMap(entry => entry.candidateAccountIds.concat(entry.accountId ?? [])));
  const byId = accounts.filter(account => ids.has(account.id));
  if (byId.length) return byId;
  // Fall back to a direct name match so an account named but not contact-linked resolves.
  return matchAccounts(mentions.join(" ").toLowerCase(), accounts);
}

export async function retrieveBusinessEvidence(
  request: BusinessRetrievalRequest | PriorClaimRecheckRequest,
  ctx: BusinessMemoryContext,
  deps: BusinessMemoryDeps = defaultBusinessMemoryDeps
): Promise<EvidenceItem[]> {
  if (!isBusinessQueryRequest(request)) {
    const outcome = await recheckPriorClaim(request, ctx, deps);
    return outcome ? outcome.evidence : [];
  }

  switch (request.kind) {
    case "contact_account_resolution": {
      const accounts = (await deps.listAccounts(ctx.tenantId)).filter(account => admitsToOperatorEvidence(account));
      const mentions = request.mentions ?? (request.contactName ? [request.contactName] : []);
      if (!mentions.length) {
        return admitBusinessEvidence(
          accounts.map(account =>
            evidenceFromAccountRef({ account, reader: "listAccountRefs", observedAtIso: ctx.nowIso })
          )
        );
      }
      const contacts = (await deps.listContacts(ctx.tenantId)).filter(contact =>
        admitsToOperatorEvidence({ name: contact.accountName, accountType: contact.accountType })
      );
      const resolutions = resolveEntityMentions(mentions, accounts, contacts);
      const resolved = resolutions
        .filter(entry => entry.kind !== "unknown")
        .map(entry =>
          evidenceFromResolution({ resolution: entry, reader: "listAccountContacts", observedAtIso: ctx.nowIso })
        );
      const ids = new Set(resolutions.flatMap(entry => entry.candidateAccountIds.concat(entry.accountId ?? [])));
      const scoped = accounts
        .filter(account => ids.has(account.id))
        .map(account => evidenceFromAccountRef({ account, reader: "listAccountRefs", observedAtIso: ctx.nowIso }));
      return admitBusinessEvidence([...resolved, ...scoped]);
    }

    case "account_state": {
      // Decomposed: current state and history are stamped separately.
      const accounts = await scopedAccounts(request, ctx, deps);
      if (!accounts.length) return [];
      const histories = await Promise.all(
        accounts.slice(0, 3).map(account =>
          deps.loadHistory({ tenantId: ctx.tenantId, operatorUserId: ctx.operatorUserId, account })
        )
      );
      return admitBusinessEvidence(
        histories.flatMap(history =>
          evidenceFromAccountHistory({ history, reader: "loadAccountHistory", observedAtIso: ctx.nowIso })
        )
      );
    }

    case "open_orders": {
      const rows = await deps.loadOpenOrders(ctx.tenantId);
      const item: EvidenceItem = {
        id: "open_orders:tenant",
        type: "open_orders",
        source: "loadUnpaidOrders",
        provenance: { reader: "loadUnpaidOrders" },
        observedAt: ctx.nowIso,
        asOf: ctx.nowIso,
        freshness: null,
        coverage: { complete: true, gaps: [] },
        authoritativeFor: ["current_business_truth"],
        payload: { openTotal: rows.length, orders: rows },
        operatorVisible: true,
      };
      return admitBusinessEvidence([item]);
    }

    case "operations":
    case "day_line_read":
    case "field_today": {
      if (!ctx.dayDirectorActorId || !ctx.businessDate || !ctx.timeZone) {
        // Say so rather than returning [] — an unconfigured read is not an empty day.
        return [
          {
            id: `${request.kind}:${UNSUPPORTED_REQUEST}`,
            type: request.kind === "field_today" ? "field_today" : "day_line_read",
            source: UNSUPPORTED_REQUEST,
            provenance: { reader: UNSUPPORTED_REQUEST },
            observedAt: ctx.nowIso,
            asOf: ctx.nowIso,
            freshness: null,
            coverage: { complete: false, gaps: ["operations context not supplied"] },
            authoritativeFor: [],
            payload: { unsupported: true, reason: "day director actor / business date / time zone missing" },
            operatorVisible: true,
          },
        ];
      }
      const work = await deps.loadOperations({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.operatorUserId,
        dayDirectorActorId: ctx.dayDirectorActorId,
        businessDate: ctx.businessDate,
        now: new Date(ctx.nowIso),
        timeZone: ctx.timeZone,
      });
      const item: EvidenceItem = {
        id: `${request.kind}:${work.businessDate}`,
        type: request.kind === "field_today" ? "field_today" : request.kind === "operations" ? "operations" : "day_line_read",
        source: "loadDayWork",
        provenance: { reader: "loadDayWork" },
        observedAt: ctx.nowIso,
        asOf: work.businessDate,
        freshness: null,
        // The route may be unavailable; that is a coverage gap, not an empty day.
        coverage: { complete: work.routeAvailable, gaps: work.routeAvailable ? [] : ["route unavailable"] },
        authoritativeFor: ["current_business_truth"],
        payload: work,
        operatorVisible: true,
      };
      return admitBusinessEvidence([item]);
    }

    case "business_query": {
      const query = request.query as BusinessQuery | undefined;
      if (!query) return [];
      const result = await deps.runQuery(ctx.tenantId, query);
      return admitBusinessEvidence([
        evidenceFromBusinessResult({ result, reader: "runBusinessQuery", observedAtIso: ctx.nowIso }),
      ]);
    }

    default:
      return [];
  }
}
