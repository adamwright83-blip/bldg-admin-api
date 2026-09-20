/**
 * Business Memory adapter — read-only.
 *
 * Wraps the EXISTING authoritative readers (`runBusinessQuery`, account readers,
 * `verifyPriorClaim`). It does not reimplement query logic, does not own a second
 * store, and never mutates. Everything crossing this boundary is filtered for
 * write-path provenance first: synthetic/test/QA rows must not reach Executive Function.
 *
 * Readers are injected so brain tests run without a database. Production defaults
 * point at the real readers; no caller in this phase has production authority.
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
  type AccountContactRef,
  type AccountRef,
} from "../../knowledge/accountKnowledge";
import {
  verifyPriorClaim,
  type FactualClaimReceipt,
  type PriorClaimVerification,
} from "../../provenance/claimReceipts";
import type { BusinessRetrievalRequest, PriorClaimRecheckRequest } from "../contracts/retrieval";
import type { EvidenceItem, PriorClaimRecheckResult } from "../contracts/evidence";
import { evidenceFromAccountRef, evidenceFromBusinessResult, evidenceFromResolution } from "./evidence";
import { resolveEntityMentions } from "./entityResolution";
import { isOperatorVisibleAccount, isOperatorVisibleEvidencePayload } from "./sourceVisibility";

export type BusinessMemoryContext = {
  tenantId: string;
  operatorUserId: string;
  nowIso: string;
  /** Receipts this conversation already holds; a recheck names one by id. */
  priorClaimReceipts?: FactualClaimReceipt[];
};

export type BusinessMemoryDeps = {
  runQuery: (tenantId: string, query: BusinessQuery) => Promise<BusinessQueryResult>;
  listAccounts: (tenantId: string) => Promise<AccountRef[]>;
  listContacts: (tenantId: string) => Promise<AccountContactRef[]>;
  verifyClaim: (receipt: FactualClaimReceipt) => Promise<PriorClaimVerification>;
};

export const defaultBusinessMemoryDeps: BusinessMemoryDeps = {
  runQuery: (tenantId, query) => runBusinessQuery(tenantId, query),
  listAccounts: tenantId => listAccountRefs(tenantId),
  listContacts: tenantId => listAccountContacts(tenantId),
  verifyClaim: receipt =>
    verifyPriorClaim(receipt, {
      rerun: query => runBusinessQuery("default", query, defaultBusinessQueryDeps),
    }),
};

function operatorVisible(item: EvidenceItem): boolean {
  const payload = (item.payload ?? {}) as {
    accountType?: string | null;
    providerName?: string | null;
    identityKey?: string | null;
    fixture?: boolean;
    synthetic?: boolean;
    evidence?: Array<Record<string, unknown>> | null;
  };
  if (!isOperatorVisibleEvidencePayload({ ...item.provenance, ...payload })) return false;
  return item.operatorVisible;
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

/** `verifyPriorClaim`'s verdict, narrowed to the brain's recheck contract. */
export function recheckResultFromVerification(verification: PriorClaimVerification): PriorClaimRecheckResult {
  return {
    receiptId: verification.receipt.id,
    resolution: verification.resolution,
    outcome: verification.outcome,
    evidenceIds: verification.receipt.evidence.map(item => item.ref ?? item.source),
  };
}

/**
 * Re-adjudicate a prior claim against fresh authoritative data.
 *
 * "Are you sure?" / "Check again." must trigger a real reread when the receipt is
 * recheckable. The receipt tells us WHAT to recheck; it is never itself proof that
 * the claim still holds. Fails closed to `unverifiable` — never to a retraction.
 */
export async function recheckPriorClaim(
  request: PriorClaimRecheckRequest,
  ctx: BusinessMemoryContext,
  deps: BusinessMemoryDeps = defaultBusinessMemoryDeps
): Promise<{ recheck: PriorClaimRecheckResult; evidence: EvidenceItem[] } | null> {
  const receipt = (ctx.priorClaimReceipts ?? []).find(item => item.id === request.receiptId);
  if (!receipt) return null;

  // Provenance mode answers "where did that come from?" from the receipt alone.
  // That is explicitly NOT a claim that the number is still true now.
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

  const verification = await deps.verifyClaim(receipt);
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
    // Only a genuine fresh reread may speak for current truth.
    authoritativeFor: recheck.resolution === "fresh_query" ? ["current_business_truth"] : ["provenance_receipt"],
    payload: { recheck, receiptId: receipt.id, timedOut: verification.timedOut },
    operatorVisible: true,
  };
  return { recheck, evidence: admitBusinessEvidence([evidence]) };
}

/**
 * Retrieve authoritative current business evidence for one typed request.
 *
 * Returning `[]` means "we did not retrieve", never "there is nothing". Executive
 * Function must not turn an empty bundle into a spoken zero.
 */
export async function retrieveBusinessEvidence(
  request: BusinessRetrievalRequest | PriorClaimRecheckRequest,
  ctx: BusinessMemoryContext,
  deps: BusinessMemoryDeps = defaultBusinessMemoryDeps
): Promise<EvidenceItem[]> {
  if (!isBusinessQueryRequest(request)) {
    const outcome = await recheckPriorClaim(request, ctx, deps);
    return outcome ? outcome.evidence : [];
  }

  if (request.kind === "contact_account_resolution" || request.kind === "account_state") {
    const accounts = await deps.listAccounts(ctx.tenantId);
    // Write-path provenance filter, before anything is scored or resolved against.
    const visible = accounts.filter(account => isOperatorVisibleAccount({ ...account }));

    const mentions = request.mentions ?? (request.contactName ? [request.contactName] : []);
    if (mentions.length) {
      const contacts = (await deps.listContacts(ctx.tenantId)).filter(contact =>
        isOperatorVisibleAccount({ name: contact.accountName, accountType: contact.accountType })
      );
      const resolutions = resolveEntityMentions(mentions, visible, contacts);
      const resolved = resolutions
        .filter(entry => entry.kind !== "unknown")
        .map(entry => evidenceFromResolution({ resolution: entry, reader: "listAccountContacts", observedAtIso: ctx.nowIso }));

      // The accounts a resolution actually points at — not the whole tenant list.
      const scopedIds = new Set(resolutions.flatMap(entry => entry.candidateAccountIds.concat(entry.accountId ?? [])));
      const scoped = visible
        .filter(account => scopedIds.has(account.id))
        .map(account => evidenceFromAccountRef({ account, reader: "listAccountRefs", observedAtIso: ctx.nowIso }));
      return admitBusinessEvidence([...resolved, ...scoped]);
    }

    const items = visible.map(account =>
      evidenceFromAccountRef({ account, reader: "listAccountRefs", observedAtIso: ctx.nowIso })
    );
    return admitBusinessEvidence(items);
  }

  const query = request.query as BusinessQuery | undefined;
  if (!query) return [];
  const result = await deps.runQuery(ctx.tenantId, query);
  const item = evidenceFromBusinessResult({
    result,
    reader: "runBusinessQuery",
    observedAtIso: ctx.nowIso,
  });
  return admitBusinessEvidence([item]);
}
