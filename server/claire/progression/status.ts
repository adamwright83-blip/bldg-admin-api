import { countProgressionEvidence, EMPTY_GRANT, type ProgressionCounts, type ProgressionGrant } from "./evaluate";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import type { DisclosureEntitlement, OperatorScope, ProgressionStore, StoredEvidence } from "./store";

/**
 * ADMIN-ONLY, STRICTLY READ-ONLY view of the hidden game: band, rung, evidence by kind, the newest
 * evidence rows, entitlements by status and the distance to the next band/rung. It never releases
 * reservations, syncs, refreshes or writes anything. Never wire this to an operator surface.
 */

export type ProgressionGap = { target: number; needs: string[] } | null;

export type ProgressionStatus = {
  scope: OperatorScope;
  policyVersion: string;
  asOf: string;
  grant: ProgressionGrant;
  counts: ProgressionCounts;
  evidenceByKind: Array<{ category: string; kind: string; rows: number }>;
  lastEvidence: Array<Omit<StoredEvidence, "tenantId" | "operatorUserId">>;
  entitlements: { unused: number; reserved: number; consumed: number };
  nextBand: ProgressionGap;
  nextRung: ProgressionGap;
};

const shortfall = (label: string, have: number, need: number) => (have < need ? [`${need - have} more ${label}`] : []);

export function summarizeProgressionStatus(input: {
  scope: OperatorScope;
  evidence: readonly StoredEvidence[];
  grant: ProgressionGrant | null;
  entitlements: readonly DisclosureEntitlement[];
  asOf: Date;
  limit?: number;
  policy?: ProgressionPolicy;
}): ProgressionStatus {
  const policy = input.policy ?? PROGRESSION_POLICY;
  const grant = input.grant ?? EMPTY_GRANT;
  const counts = countProgressionEvidence(input.evidence, input.asOf, policy);
  const byKind = new Map<string, { category: string; kind: string; rows: number }>();
  for (const row of input.evidence) {
    const key = `${row.category}:${row.kind}`;
    const entry = byKind.get(key) ?? { category: row.category, kind: row.kind, rows: 0 };
    entry.rows += 1;
    byKind.set(key, entry);
  }
  const band = policy.rapport.find(threshold => threshold.band > grant.rapportBand);
  const rung = policy.rungs.find(threshold => threshold.rung > grant.personalRung);
  return {
    scope: input.scope,
    policyVersion: policy.version,
    asOf: input.asOf.toISOString(),
    grant,
    counts,
    evidenceByKind: [...byKind.values()].sort((a, b) => b.rows - a.rows || a.kind.localeCompare(b.kind)),
    lastEvidence: [...input.evidence]
      .sort((a, b) => Date.parse(b.recognizedAt) - Date.parse(a.recognizedAt) || b.id.localeCompare(a.id))
      .slice(0, input.limit ?? 20)
      .map(({ tenantId: _t, operatorUserId: _o, ...row }) => row),
    entitlements: {
      unused: input.entitlements.filter(row => row.status === "unused").length,
      reserved: input.entitlements.filter(row => row.status === "reserved").length,
      consumed: input.entitlements.filter(row => row.status === "consumed").length,
    },
    nextBand: band
      ? {
          target: band.band,
          needs: [
            ...shortfall("growth actions", counts.growthActions, band.minActions),
            ...shortfall("distinct action days", counts.growthActionDays, band.minActionDays),
          ],
        }
      : null,
    nextRung: rung
      ? {
          target: rung.rung,
          needs: [
            ...shortfall("growth actions", counts.growthActions, rung.minActions),
            ...shortfall("distinct action days", counts.growthActionDays, rung.minActionDays),
            ...shortfall("post-epoch progress events", counts.progressEvents, rung.minProgressEvents),
            ...shortfall("strong results", counts.strongResults, rung.minStrongResults),
            ...(rung.requireDisclosureSafety ? ["disclosure safety must hold"] : []),
          ],
        }
      : null,
  };
}

export async function readProgressionStatus(
  store: ProgressionStore,
  scope: OperatorScope,
  options: { now?: Date; limit?: number } = {}
): Promise<ProgressionStatus> {
  const [evidence, grant, entitlements] = await Promise.all([
    store.listEvidence(scope),
    store.getGrant(scope),
    store.listEntitlements(scope),
  ]);
  return summarizeProgressionStatus({ scope, evidence, grant, entitlements, asOf: options.now ?? new Date(), limit: options.limit });
}
