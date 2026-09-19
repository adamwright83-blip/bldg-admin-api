import type { ProgressionGrant } from "./evaluate";
import type { OperatorScope, ProgressionStore } from "./store";

/**
 * READ-ONLY continuity report for the activation decision. It describes what state ACTUALLY exists per
 * (tenantId, operatorUserId) before `CLAIRE_PROGRESSION` is enabled: the legacy relationship/disclosure
 * state AND the new progression tables, which accumulate passively while the flag is OFF (confirmed
 * field visits and completed follow-ups keep recording evidence, refreshing grants and minting
 * entitlements; none of it can affect Claire until the flag is ON).
 *
 * This module never writes. It does not choose a policy; it presents the three options for a human.
 */

export type LegacyOperatorState = {
  /** False when the operator has generation logs / relationship events but no cached relationship-state row. */
  hasRelationshipState: boolean;
  disclosureTier: number;
  qualifyingInteractionCount: number;
  distinctInteractionDays: number;
  personalModeGenerations: number;
  /** Canon fragment ids that were ELIGIBLE in past personal-mode generations (an upper bound, not proof of disclosure). */
  eligibleCanonFragmentIds: string[];
  attestedDisclosureEvents: number;
} | null;

export type NewProgressionSnapshot = {
  /** A grant row exists (even an all-zero one). */
  grantRowExists: boolean;
  rapportBand: number;
  personalRung: number;
  rapportPolicyVersion: string | null;
  rungPolicyVersion: string | null;
  entitlementCursor: string | null;
  evidenceByCategoryKind: Record<string, number>;
  evidenceTotal: number;
  entitlements: { unused: number; reserved: number; consumed: number };
  disclosedFragmentIds: string[];
  ledgerEntryCount: number;
  latest: {
    evidenceOccurredAt: string | null;
    evidenceRecognizedAt: string | null;
    entitlementMintedAt: string | null;
    entitlementConsumedAt: string | null;
    ledgerAt: string | null;
  };
};

/**
 *  - pristine: nothing persisted in the new system.
 *  - persisted_state_not_behavioral: the new system holds persisted state (e.g. an entitlement cursor, a grant row,
 *    policy versions) that does NOT by itself change Claire's behavior on enable, but is real continuity state
 *    (a cursor decides which future progress events mint entitlements).
 *  - dormant_active_on_enable: state that WOULD change Claire's behavior if the flag were enabled.
 */
export type ContinuityClass = "pristine" | "persisted_state_not_behavioral" | "dormant_active_on_enable";

export type OperatorContinuityRecord = OperatorScope & {
  legacy: LegacyOperatorState;
  progression: NewProgressionSnapshot;
  continuityClass: ContinuityClass;
  /** Behavioral: the new tables hold state that would become active if the flag were enabled. */
  dormantProgressionWouldActivate: boolean;
  dormantReasons: string[];
  /** Non-behavioral persisted new-system state that still matters to the continuity decision. */
  persistedStateReasons: string[];
  /** True when legacy access/possible prior disclosures exist that the new system does not know about. */
  legacyStateNotCarriedOver: boolean;
};

export const CONTINUITY_DECISION_OPTIONS = [
  {
    id: "preserve",
    summary: "PRESERVE accumulated new progression: enable as-is; dormant rapport, rung, entitlements and disclosed fragments become active.",
  },
  {
    id: "reset",
    summary: "RESET new progression: clear the new progression/entitlement/ledger rows for the operator before enabling, so the mechanic starts from zero.",
  },
  {
    id: "reconcile",
    summary: "MIGRATE / RECONCILE deliberately: carry specific legacy tier or possibly-disclosed facts into the new state, operator by operator, with its own review.",
  },
] as const;

/**
 * Every operator that appears in ANY source the report reads: legacy relationship state, legacy generation
 * logs, legacy relationship events, and every new progression table. Rows with no operator id are skipped.
 */
export function enumerateOperatorScopes(
  sources: ReadonlyArray<ReadonlyArray<{ tenantId: string; operatorUserId: string | null }>>,
  tenantFilter?: string
): OperatorScope[] {
  const scopes = new Map<string, OperatorScope>();
  for (const source of sources) {
    for (const row of source) {
      if (!row.operatorUserId) continue;
      if (tenantFilter && row.tenantId !== tenantFilter) continue;
      scopes.set(`${row.tenantId}::${row.operatorUserId}`, { tenantId: row.tenantId, operatorUserId: row.operatorUserId });
    }
  }
  return [...scopes.values()].sort((a, b) => `${a.tenantId}\u0000${a.operatorUserId}`.localeCompare(`${b.tenantId}\u0000${b.operatorUserId}`));
}

const maxIso = (values: Array<string | null | undefined>): string | null => {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length ? present.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
};

/**
 * Collect the new-progression snapshot using READ methods only (the store's get and list methods). Deliberately does NOT use
 * loadPersonalProgressionContext, which lazily releases expired reservations (a write).
 */
export async function collectProgressionSnapshot(store: ProgressionStore, scope: OperatorScope): Promise<NewProgressionSnapshot> {
  const [grant, evidence, entitlements, ledger] = await Promise.all([
    store.getGrant(scope),
    store.listEvidence(scope),
    store.listEntitlements(scope),
    store.listLedger(scope),
  ]);
  const g: ProgressionGrant | null = grant;
  const byKind: Record<string, number> = {};
  for (const item of evidence) byKind[`${item.category}/${item.kind}`] = (byKind[`${item.category}/${item.kind}`] ?? 0) + 1;
  return {
    grantRowExists: g !== null,
    rapportBand: g?.rapportBand ?? 0,
    personalRung: g?.personalRung ?? 0,
    rapportPolicyVersion: g?.rapportPolicyVersion ?? null,
    rungPolicyVersion: g?.rungPolicyVersion ?? null,
    entitlementCursor: g?.entitlementCursor ?? null,
    evidenceByCategoryKind: byKind,
    evidenceTotal: evidence.length,
    entitlements: {
      unused: entitlements.filter(e => e.status === "unused").length,
      reserved: entitlements.filter(e => e.status === "reserved").length,
      consumed: entitlements.filter(e => e.status === "consumed").length,
    },
    disclosedFragmentIds: [...new Set(ledger.filter(row => row.kind === "disclosed" && row.fragmentId).map(row => row.fragmentId!))].sort(),
    ledgerEntryCount: ledger.length,
    latest: {
      evidenceOccurredAt: maxIso(evidence.map(e => e.occurredAt)),
      evidenceRecognizedAt: maxIso(evidence.map(e => e.recognizedAt)),
      entitlementMintedAt: maxIso(entitlements.map(e => e.mintedAt)),
      entitlementConsumedAt: maxIso(entitlements.map(e => e.consumedAt)),
      ledgerAt: maxIso(ledger.map(row => row.occurredAt)),
    },
  };
}

export function buildOperatorContinuityRecord(input: {
  scope: OperatorScope;
  legacy: LegacyOperatorState;
  progression: NewProgressionSnapshot;
}): OperatorContinuityRecord {
  const p = input.progression;
  const reasons: string[] = [];
  if (p.rapportBand > 0) reasons.push(`rapport band ${p.rapportBand} would change how Claire sounds`);
  if (p.personalRung > 0) reasons.push(`personal-access rung ${p.personalRung} would make gated canon answerable`);
  if (p.entitlements.unused > 0) reasons.push(`${p.entitlements.unused} unused disclosure entitlement(s) would allow new reveals`);
  if (p.entitlements.reserved > 0) reasons.push(`${p.entitlements.reserved} reserved (undelivered) entitlement(s)`);
  if (p.entitlements.consumed > 0 || p.disclosedFragmentIds.length > 0) reasons.push(`${p.entitlements.consumed} consumed entitlement(s); disclosed fragments: ${p.disclosedFragmentIds.join(", ") || "none"}`);
  if (p.evidenceTotal > 0 && reasons.length === 0) reasons.push(`${p.evidenceTotal} evidence row(s) exist and will count toward rapport/rung on the next refresh`);
  // Persisted state that is not, on its own, behavioral: still not "pristine".
  const persisted: string[] = [];
  if (p.entitlementCursor) persisted.push(`entitlement cursor ${p.entitlementCursor} (decides which future progress events mint entitlements; it can be set even when no event was minted)`);
  if (p.grantRowExists && persisted.length === 0 && reasons.length === 0 && p.evidenceTotal === 0) persisted.push("a grant row exists (all zero)");
  if (p.rapportPolicyVersion || p.rungPolicyVersion) persisted.push(`policy version(s) recorded: rapport ${p.rapportPolicyVersion ?? "-"}, rung ${p.rungPolicyVersion ?? "-"}`);
  if (p.ledgerEntryCount > 0 && reasons.length === 0) persisted.push(`${p.ledgerEntryCount} personal-ledger row(s) (asked/declined history; no disclosure)`);
  const behavioral = reasons.length > 0;
  const legacy = input.legacy;
  return {
    ...input.scope,
    legacy,
    progression: p,
    continuityClass: behavioral ? "dormant_active_on_enable" : persisted.length > 0 ? "persisted_state_not_behavioral" : "pristine",
    dormantProgressionWouldActivate: behavioral,
    dormantReasons: reasons,
    persistedStateReasons: persisted,
    legacyStateNotCarriedOver: Boolean(legacy && (legacy.disclosureTier > 0 || legacy.eligibleCanonFragmentIds.length > 0 || legacy.attestedDisclosureEvents > 0)),
  };
}

export function formatContinuityReport(records: readonly OperatorContinuityRecord[], generatedAt: Date): string {
  const lines: string[] = [];
  lines.push(`# Claire progression continuity report (${generatedAt.toISOString()}) — READ ONLY`);
  lines.push(`operators inspected: ${records.length}`);
  const count = (c: ContinuityClass) => records.filter(r => r.continuityClass === c).length;
  lines.push(`pristine (no persisted new-system state): ${count("pristine")}`);
  lines.push(`persisted new-system state that is not behavioral by itself (e.g. cursor): ${count("persisted_state_not_behavioral")}`);
  lines.push(`DORMANT progression that becomes behaviorally active on enable: ${count("dormant_active_on_enable")}`);
  lines.push(`operators with legacy state the new system will not know about: ${records.filter(r => r.legacyStateNotCarriedOver).length}`);
  lines.push("");
  for (const r of records) {
    const p = r.progression;
    lines.push(`- tenant=${r.tenantId} operator=${r.operatorUserId}`);
    lines.push(
      r.legacy
        ? `    legacy${r.legacy.hasRelationshipState ? "" : " (no relationship-state row; from logs/events only)"}: tier ${r.legacy.disclosureTier}; qualifying interactions ${r.legacy.qualifyingInteractionCount} over ${r.legacy.distinctInteractionDays} day(s); personal generations ${r.legacy.personalModeGenerations}; eligible-in-past canon [${r.legacy.eligibleCanonFragmentIds.join(", ") || "none"}]; attested disclosures ${r.legacy.attestedDisclosureEvents}`
        : "    legacy: no relationship state"
    );
    lines.push(`    new: rapportBand ${p.rapportBand} (${p.rapportPolicyVersion ?? "-"}); personalRung ${p.personalRung} (${p.rungPolicyVersion ?? "-"}); cursor ${p.entitlementCursor ?? "none"}`);
    lines.push(`    evidence (${p.evidenceTotal}): ${Object.entries(p.evidenceByCategoryKind).map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
    lines.push(`    entitlements: unused ${p.entitlements.unused}, reserved ${p.entitlements.reserved}, consumed ${p.entitlements.consumed}`);
    lines.push(`    disclosed (new ledger): [${p.disclosedFragmentIds.join(", ") || "none"}] across ${p.ledgerEntryCount} ledger row(s)`);
    lines.push(`    latest: evidence occurred ${p.latest.evidenceOccurredAt ?? "-"}, recognized ${p.latest.evidenceRecognizedAt ?? "-"}; minted ${p.latest.entitlementMintedAt ?? "-"}; consumed ${p.latest.entitlementConsumedAt ?? "-"}; ledger ${p.latest.ledgerAt ?? "-"}`);
    const onEnable =
      r.continuityClass === "dormant_active_on_enable"
        ? `DORMANT PROGRESSION BECOMES ACTIVE — ${r.dormantReasons.join("; ")}`
        : r.continuityClass === "persisted_state_not_behavioral"
          ? `PERSISTED NEW-SYSTEM STATE PRESENT (not behavior-changing by itself, NOT pristine) — ${r.persistedStateReasons.join("; ")}`
          : "pristine: nothing persisted in the new system; starts from zero";
    lines.push(`    ON ENABLE: ${onEnable}${r.legacyStateNotCarriedOver ? "  ** legacy access / possible prior disclosures are NOT carried over **" : ""}`);
  }
  lines.push("");
  lines.push("## Decision required (this report does not choose)");
  for (const option of CONTINUITY_DECISION_OPTIONS) lines.push(`- ${option.summary}`);
  return lines.join("\n");
}
