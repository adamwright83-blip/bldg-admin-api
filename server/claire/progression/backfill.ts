import { countProgressionEvidence, EMPTY_GRANT, type ProgressionCounts, type ProgressionGrant } from "./evaluate";
import { validateEvidenceInput } from "./evidence";
import type { DerivedEvidence, SkippedSource } from "./fieldEvidence";
import { PROGRESSION_POLICY } from "./policy";
import { recordProgressionEvidence, refreshProgression } from "./service";
import {
  createInMemoryProgressionStore,
  type DisclosureEntitlement,
  type OperatorScope,
  type ProgressionStore,
  type StoredEvidence,
} from "./store";

/**
 * Idempotent progression backfill: re-derive evidence for ONE operator from the authoritative sources
 * (field outcomes, completed follow-ups, canonical order truth) and credit what the live feeds missed.
 *
 * NOT auto-run. Dry-run is the default and writes nothing: it projects the result by replaying the real
 * `refreshProgression` against an in-memory copy of the operator's current state. Apply goes through the
 * same governed writer as the live feeds (`recordProgressionEvidence` → `refreshProgression`), so:
 *  - evidence identity is the source event, so a second run creates nothing;
 *  - grants never decrease;
 *  - entitlement minting follows the no-backlog rule (at most ONE initial entitlement however much is credited);
 *  - nothing here can create call-volume, chat or proposal-approval evidence: validation rejects those kinds.
 */

export type BackfillCandidate = DerivedEvidence & {
  /** Which loader produced it, and through which identity (the operator or a named alias). */
  origin: string;
};

export type BackfillSources = {
  candidates: BackfillCandidate[];
  skipped: Array<SkippedSource & { origin: string }>;
  /** Evidence already held under alias scopes. Reported, never moved. */
  aliasHeldEvidence: Array<{ operatorUserId: string; rows: number }>;
  /** Day 1 driver ids in the tenant that were NOT folded in. Name them with --alias if they are this operator. */
  unclaimedDay1DriverIds?: string[];
};

export type BackfillPlanRow = BackfillCandidate & { action: "mint" | "already_held" | "rejected"; reason?: string };

export type BackfillPlan = {
  scope: OperatorScope;
  asOf: string;
  policyVersion: string;
  rows: BackfillPlanRow[];
  skipped: BackfillSources["skipped"];
  aliasHeldEvidence: BackfillSources["aliasHeldEvidence"];
  unclaimedDay1DriverIds: string[];
  before: { grant: ProgressionGrant; counts: ProgressionCounts; entitlements: number };
  after: { grant: ProgressionGrant; counts: ProgressionCounts; entitlementsMinted: number };
};

const identity = (row: { category: string; sourceType: string; sourceId: string }) =>
  `${row.category}::${row.sourceType}::${row.sourceId}`;
const iso = (value: Date | string) => (typeof value === "string" ? new Date(value) : value).toISOString();

/** Pure planning over already-read state. Exported for tests; `planProgressionBackfill` wraps it with reads. */
export async function projectBackfill(input: {
  scope: OperatorScope;
  sources: BackfillSources;
  existing: StoredEvidence[];
  grant: ProgressionGrant | null;
  entitlements: DisclosureEntitlement[];
  disclosureSafetyOk: boolean;
  now: Date;
}): Promise<BackfillPlan> {
  const held = new Set(input.existing.map(identity));
  const seen = new Set<string>();
  const rows: BackfillPlanRow[] = [];
  for (const candidate of input.sources.candidates) {
    const key = identity(candidate);
    if (held.has(key)) {
      rows.push({ ...candidate, action: "already_held" });
      continue;
    }
    if (seen.has(key)) continue; // same source event seen through two aliases: one identity
    const validation = validateEvidenceInput({
      category: candidate.category,
      kind: candidate.kind,
      occurredAt: iso(candidate.occurredAt),
      recognizedAt: iso(candidate.recognizedAt ?? candidate.occurredAt),
    });
    if (!validation.ok) {
      rows.push({ ...candidate, action: "rejected", reason: validation.reason });
      continue;
    }
    seen.add(key);
    rows.push({ ...candidate, action: "mint" });
  }

  // Replay the real service against an in-memory copy. Never the production store.
  const shadow = createInMemoryProgressionStore();
  for (const row of input.existing) await shadow.insertEvidence(row);
  if (input.grant) await shadow.upsertGrantMonotonic(input.scope, input.grant);
  for (const entitlement of input.entitlements) {
    const { id: _id, ...rest } = entitlement;
    await shadow.insertEntitlementIfAbsent(rest);
  }
  const now = () => input.now;
  let planned = 0;
  for (const row of rows.filter(item => item.action === "mint")) {
    planned += 1;
    await shadow.insertEvidence({
      ...input.scope,
      id: `planned-${planned}`,
      category: row.category,
      kind: row.kind,
      strength: row.category === "business_progress" ? "strong" : null,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      provenance: row.provenance,
      occurredAt: iso(row.occurredAt),
      recognizedAt: iso(row.recognizedAt ?? row.occurredAt),
    });
  }
  const projected = await refreshProgression(shadow, input.scope, { disclosureSafetyOk: input.disclosureSafetyOk, now });

  return {
    scope: input.scope,
    asOf: input.now.toISOString(),
    policyVersion: PROGRESSION_POLICY.version,
    rows,
    skipped: input.sources.skipped,
    aliasHeldEvidence: input.sources.aliasHeldEvidence,
    unclaimedDay1DriverIds: input.sources.unclaimedDay1DriverIds ?? [],
    before: {
      grant: input.grant ?? EMPTY_GRANT,
      counts: countProgressionEvidence(input.existing, input.now),
      entitlements: input.entitlements.length,
    },
    after: { grant: projected.grant, counts: projected.counts, entitlementsMinted: projected.mintedEntitlementIds.length },
  };
}

export type BackfillDeps = {
  store: ProgressionStore;
  loadSources: (scope: OperatorScope) => Promise<BackfillSources>;
  loadDisclosureSafetyOk: (scope: OperatorScope) => Promise<boolean>;
  now?: () => Date;
};

export async function planProgressionBackfill(scope: OperatorScope, deps: BackfillDeps): Promise<BackfillPlan> {
  const now = (deps.now ?? (() => new Date()))();
  const [sources, existing, grant, entitlements, disclosureSafetyOk] = await Promise.all([
    deps.loadSources(scope),
    deps.store.listEvidence(scope),
    deps.store.getGrant(scope),
    deps.store.listEntitlements(scope),
    deps.loadDisclosureSafetyOk(scope),
  ]);
  return projectBackfill({ scope, sources, existing, grant, entitlements, disclosureSafetyOk, now });
}

export type BackfillApplyResult = { plan: BackfillPlan; created: number; grant: ProgressionGrant; mintedEntitlementIds: string[] };

/** Writes through the governed path. Safe to re-run: the second run creates nothing. */
export async function applyProgressionBackfill(scope: OperatorScope, deps: BackfillDeps): Promise<BackfillApplyResult> {
  const plan = await planProgressionBackfill(scope, deps);
  const now = deps.now ?? (() => new Date());
  let created = 0;
  for (const row of plan.rows.filter(item => item.action === "mint")) {
    const result = await recordProgressionEvidence(deps.store, { ...scope, ...row, provenance: row.provenance }, now);
    if (result.ok && result.created) created += 1;
  }
  const snapshot = await refreshProgression(deps.store, scope, {
    disclosureSafetyOk: await deps.loadDisclosureSafetyOk(scope),
    now,
  });
  return { plan, created, grant: snapshot.grant, mintedEntitlementIds: snapshot.mintedEntitlementIds };
}

const pad = (value: string, width: number) => (value.length >= width ? value : value + " ".repeat(width - value.length));
const day = (value: Date | string) => iso(value).slice(0, 16).replace("T", " ");

/** Plain-text report for the CLI. Admin-only output; never shown to the operator. */
export function formatBackfillReport(plan: BackfillPlan, mode: "dry-run" | "applied"): string {
  const lines: string[] = [];
  const g = (grant: ProgressionGrant) => `band ${grant.rapportBand}, rung ${grant.personalRung}`;
  const c = (counts: ProgressionCounts) =>
    `${counts.growthActions} actions on ${counts.growthActionDays} days, ${counts.progressEvents} progress (${counts.strongResults} strong)`;
  lines.push(`Claire progression backfill — ${mode.toUpperCase()}`);
  lines.push(`tenant ${plan.scope.tenantId} · operator ${plan.scope.operatorUserId} · policy ${plan.policyVersion} · as of ${plan.asOf}`);
  lines.push("");
  const mint = plan.rows.filter(row => row.action === "mint");
  lines.push(`${mode === "dry-run" ? "WOULD MINT" : "MINTED"} (${mint.length})`);
  for (const row of mint) {
    lines.push(`  + ${pad(row.category, 17)} ${pad(row.kind, 24)} ${pad(`${row.sourceType}:${row.sourceId}`, 40)} occurred ${day(row.occurredAt)}  via ${row.origin}`);
  }
  const held = plan.rows.filter(row => row.action === "already_held");
  lines.push(`ALREADY HELD (${held.length})`);
  for (const row of held) lines.push(`  = ${pad(row.kind, 24)} ${row.sourceType}:${row.sourceId}`);
  const rejected = plan.rows.filter(row => row.action === "rejected");
  if (rejected.length) {
    lines.push(`REJECTED BY VALIDATION (${rejected.length})`);
    for (const row of rejected) lines.push(`  x ${row.kind} ${row.sourceType}:${row.sourceId} — ${row.reason}`);
  }
  lines.push(`SKIPPED SOURCES (${plan.skipped.length})`);
  for (const item of plan.skipped) lines.push(`  - ${item.sourceType}:${item.sourceId} — ${item.reason} (${item.origin})`);
  if (plan.aliasHeldEvidence.length) {
    lines.push("EVIDENCE HELD UNDER ALIAS SCOPES (not moved)");
    for (const alias of plan.aliasHeldEvidence) lines.push(`  ~ ${alias.operatorUserId}: ${alias.rows} rows`);
  }
  if (plan.unclaimedDay1DriverIds.length) {
    lines.push(`UNCLAIMED DAY 1 DRIVER IDS (not credited; pass --alias <id> if they are this operator): ${plan.unclaimedDay1DriverIds.join(", ")}`);
  }
  lines.push("");
  lines.push(`before: ${g(plan.before.grant)} · ${c(plan.before.counts)} · ${plan.before.entitlements} entitlements`);
  lines.push(`after:  ${g(plan.after.grant)} · ${c(plan.after.counts)} · +${plan.after.entitlementsMinted} entitlements`);
  const nextBand = PROGRESSION_POLICY.rapport.find(t => t.band > plan.after.grant.rapportBand);
  const nextRung = PROGRESSION_POLICY.rungs.find(t => t.rung > plan.after.grant.personalRung);
  if (nextBand) {
    lines.push(`next band ${nextBand.band}: needs ${nextBand.minActions} actions on ${nextBand.minActionDays} days`);
  }
  if (nextRung) {
    lines.push(
      `next rung ${nextRung.rung}: needs ${nextRung.minActions} actions on ${nextRung.minActionDays} days + ${nextRung.minProgressEvents} progress (${nextRung.minStrongResults} strong)${nextRung.requireDisclosureSafety ? " + disclosure safety" : ""}`
    );
  }
  return lines.join("\n");
}
