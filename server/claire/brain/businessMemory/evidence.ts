/**
 * Business Memory evidence construction.
 *
 * Converts results from the EXISTING authoritative readers into `EvidenceItem`s.
 * This module does not query anything and does not reimplement `businessQuery`.
 * Its only job is to carry provenance, freshness, coverage, as-of/observed times,
 * and authoritative scope across the boundary into Executive Function without loss.
 *
 * A result that could not be resolved never claims `current_business_truth`.
 * Failing closed here is what stops an unavailable read from being spoken as a fact.
 */

import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import type { AccountRef } from "../../knowledge/accountKnowledge";
import type {
  EvidenceAuthority,
  EvidenceCoverage,
  EvidenceFreshness,
  EvidenceItem,
  EvidenceProvenance,
} from "../contracts/evidence";

/** Stable member identity for ordered-query continuation (resolved vs presented). */
export type ResolvedMember = { id: string; label: string | null };

function digest(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Deterministic id so the same read in the same turn is the same evidence. */
export function businessQueryFingerprint(result: BusinessQueryResult): string {
  return digest({
    metric: result.query.metric,
    period: result.period.start + ".." + result.period.end,
    customerName: result.query.customerName,
    limit: result.query.limit,
    rank: result.query.rank,
    filters: result.query.filters ?? null,
    serviceType: result.query.serviceType,
  });
}

function coverageFrom(result: BusinessQueryResult): EvidenceCoverage | null {
  if (result.status !== "ok" || !result.coverage) return null;
  const gaps: string[] = [];
  const { coverage } = result;
  if (coverage.completeness !== "complete") gaps.push(`ledger_completeness:${coverage.completeness}`);
  for (const failed of coverage.failedSources) gaps.push(`failed_source:${failed}`);
  if (coverage.unverifiedNativeCount > 0) gaps.push(`unverified_native_orders:${coverage.unverifiedNativeCount}`);
  if (coverage.serviceFilterUnclassified && coverage.serviceFilterUnclassified.orders > 0) {
    gaps.push(`service_filter_unclassified:${coverage.serviceFilterUnclassified.orders}`);
  }
  return { complete: gaps.length === 0, gaps };
}

function freshnessFrom(result: BusinessQueryResult): EvidenceFreshness | null {
  if (result.status !== "ok" || !result.coverage) return null;
  return {
    completeness: result.coverage.completeness,
    loadedSources: [...result.coverage.loadedSources],
    failedSources: [...result.coverage.failedSources],
  };
}

/**
 * Members of an ordered result, in the order the reader returned them.
 * These identities are what "the other four" walks — never a fresh query window.
 */
export function resolvedMembers(result: BusinessQueryResult): ResolvedMember[] {
  if (result.status !== "ok") return [];
  const data = result.data;
  switch (data.kind) {
    case "orders":
      return data.orders.map(order => ({
        id: order.eventKey,
        label: order.customerName ?? order.orderNumber ?? null,
      }));
    case "top_customers":
      return data.members.map(member => ({ id: member.identityId, label: member.displayName }));
    case "customers":
      return data.population.members.map(member => ({ id: member.identityId, label: member.displayName }));
    case "customer_history":
      return data.matches.map(match => ({ id: match.identityId, label: match.displayName }));
    case "customer_share":
      return data.top.map(member => ({ id: member.identityId, label: member.displayName }));
    case "period_ranking":
      return data.rows.map(row => ({ id: row.key, label: row.key }));
    default:
      return [];
  }
}

/**
 * An unavailable read is still evidence — evidence that we could not see, which is
 * exactly what must reach Executive Function instead of silence or a zero.
 */
export function evidenceFromBusinessResult(input: {
  result: BusinessQueryResult;
  reader: string;
  observedAtIso: string;
}): EvidenceItem {
  const { result, reader, observedAtIso } = input;
  const resolved = result.status === "ok";
  const authoritativeFor: EvidenceAuthority[] = resolved ? ["current_business_truth"] : [];
  const provenance: EvidenceProvenance = { reader };
  return {
    id: `business_query:${result.query.metric}:${businessQueryFingerprint(result)}`,
    type: "business_query",
    source: reader,
    provenance,
    observedAt: observedAtIso,
    // The period end is what the numbers are true "as of", not the clock time we asked.
    asOf: result.period.end,
    freshness: freshnessFrom(result),
    coverage: coverageFrom(result),
    authoritativeFor,
    payload: result,
    operatorVisible: true,
  };
}

/** Account rows carry a write-path `accountType`, which the synthetic filter reads. */
export function evidenceFromAccountRef(input: {
  account: AccountRef;
  reader: string;
  observedAtIso: string;
}): EvidenceItem {
  const { account, reader, observedAtIso } = input;
  return {
    id: `account_state:${account.id}`,
    type: "account_state",
    source: reader,
    provenance: { reader, accountType: account.accountType },
    observedAt: observedAtIso,
    asOf: observedAtIso,
    freshness: null,
    coverage: null,
    authoritativeFor: ["current_business_truth"],
    payload: { accountId: account.id, name: account.name, accountType: account.accountType },
    operatorVisible: true,
  };
}
