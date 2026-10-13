import { createHash } from "node:crypto";
import { readNativeCustomerHistory } from "../../domains/orders/orderHistoryReadService";
import { loadBusinessSourceCoverage, type BusinessSourceCoverageSnapshot } from "../../analytics/sourceCoverage";
import { identityKeysFor, normalizeIdentityPhone } from "../../analytics/customerIdentityResolution";
import type { IdentityEvidence } from "../../analytics/customerIdentityResolution";
import {
  readCustomerRecoveryInterventions,
  readRecentOutboundCommunications,
  type RecoveryInterventionRecord,
  type CommunicationReceiptRecord,
} from "../../domains/recovery/customerRecoveryReadService";

export type RecoverySafetyEvidence = {
  openOrderCount: number | null;
  lastOutreachOn: string | null;
  attestedOutreachOn: string | null;
  unresolvedRecovery: boolean;
  unavailableReason: string | null;
};

type NativeRow = Awaited<ReturnType<typeof readNativeCustomerHistory>>[number];
type RecoveryRow = RecoveryInterventionRecord;
type CommunicationRow = CommunicationReceiptRecord;

/** A paid export cannot prove that the same customer has no active external job. */
export function deriveRecoverySafety(input: {
  tenantId: string;
  identityKeys: readonly string[];
  nativeOrders: readonly NativeRow[] | null;
  coverage: BusinessSourceCoverageSnapshot | null;
  recoveries: readonly RecoveryRow[] | null;
  communications: readonly CommunicationRow[] | null;
}): RecoverySafetyEvidence {
  const keys = new Set(input.identityKeys);
  const matched = input.nativeOrders?.filter(row => identityKeysFor(row as IdentityEvidence).some(key => keys.has(key)));
  const active = matched?.filter(row => !["delivered", "cancelled"].includes(row.status)).length;
  const source = input.coverage?.sources.find(source => source.sourceId === "laundry_butler");
  const external = input.coverage?.sources.find(source => source.sourceId === "cleancloud");
  const nativeOnlyCurrent = Boolean(input.coverage?.tenantId === input.tenantId &&
    source?.supportsExhaustiveCurrentClaim && external?.availability === "not_held");
  // Positive native evidence remains useful even if the rest of the book is unavailable.
  const openOrderCount = active && active > 0 ? active :
    input.nativeOrders && nativeOnlyCurrent ? 0 : null;
  const hashes = new Set([...keys].map(key => createHash("sha256").update(`${input.tenantId}:${key}`).digest("hex")));
  const recoveries = input.recoveries?.filter(row => hashes.has(row.customerKeyHash)) ?? [];
  const attested = recoveries.flatMap(row => row.contactedAt ? [row.contactedAt.toISOString()] : []).sort().at(-1) ?? null;
  const phones = new Set([...keys].filter(key => key.startsWith("phone:")).map(key => key.slice(6)));
  const sent = input.communications?.filter(row => row.direction === "outbound" &&
    ["sent", "delivered", "completed"].includes(row.status ?? "") &&
    phones.has(normalizeIdentityPhone(row.toNumber) ?? ""))
    .map(row => row.createdAt.toISOString()).sort().at(-1) ?? null;
  const unavailableReason = !input.nativeOrders ? "Native active orders could not be checked." :
    openOrderCount === null ? "The paid customer book does not establish current active CleanCloud jobs; verify them before recovery outreach." :
    !input.recoveries || !input.communications ? "Recorded outreach history could not be checked." : null;
  return {
    openOrderCount, lastOutreachOn: sent, attestedOutreachOn: attested,
    unresolvedRecovery: recoveries.some(row => ["draft_pending_review", "approved", "contacted"].includes(row.status)),
    unavailableReason,
  };
}

export async function loadRecoverySafetyEvidence(input: {
  tenantId: string;
  now: Date;
  cooldownDays: number;
}) {
  if (!input.tenantId.trim()) throw new Error("Recovery evidence requires tenant authority");
  const since = new Date(input.now.getTime() - Math.max(1, input.cooldownDays) * 86_400_000);
  const [nativeOrders, coverage, recoveries, communications] = await Promise.all([
    readNativeCustomerHistory(input.tenantId).catch(() => null),
    loadBusinessSourceCoverage({ tenantId: input.tenantId, now: input.now }).catch(() => null),
    readCustomerRecoveryInterventions(input.tenantId).catch(() => null),
    readRecentOutboundCommunications(input.tenantId, since).catch(() => null),
  ]);
  return { tenantId: input.tenantId, nativeOrders, coverage, recoveries, communications };
}
