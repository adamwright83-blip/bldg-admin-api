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
  disclosureTier: number;
  qualifyingInteractionCount: number;
  distinctInteractionDays: number;
  personalModeGenerations: number;
  /** Canon fragment ids that were ELIGIBLE in past personal-mode generations (an upper bound, not proof of disclosure). */
  eligibleCanonFragmentIds: string[];
  attestedDisclosureEvents: number;
} | null;

export type NewProgressionSnapshot = {
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

export type OperatorContinuityRecord = OperatorScope & {
  legacy: LegacyOperatorState;
  progression: NewProgressionSnapshot;
  /** True when the new tables already hold state that would become behaviorally active if the flag were enabled. */
  dormantProgressionWouldActivate: boolean;
  dormantReasons: string[];
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
  const legacy = input.legacy;
  return {
    ...input.scope,
    legacy,
    progression: p,
    dormantProgressionWouldActivate: reasons.length > 0,
    dormantReasons: reasons,
    legacyStateNotCarriedOver: Boolean(legacy && (legacy.disclosureTier > 0 || legacy.eligibleCanonFragmentIds.length > 0 || legacy.attestedDisclosureEvents > 0)),
  };
}

export function formatContinuityReport(records: readonly OperatorContinuityRecord[], generatedAt: Date): string {
  const lines: string[] = [];
  lines.push(`# Claire progression continuity report (${generatedAt.toISOString()}) — READ ONLY`);
  lines.push(`operators inspected: ${records.length}`);
  lines.push(`operators with DORMANT new progression that would activate on enable: ${records.filter(r => r.dormantProgressionWouldActivate).length}`);
  lines.push(`operators with legacy state the new system will not know about: ${records.filter(r => r.legacyStateNotCarriedOver).length}`);
  lines.push("");
  for (const r of records) {
    const p = r.progression;
    lines.push(`- tenant=${r.tenantId} operator=${r.operatorUserId}`);
    lines.push(
      r.legacy
        ? `    legacy: tier ${r.legacy.disclosureTier}; qualifying interactions ${r.legacy.qualifyingInteractionCount} over ${r.legacy.distinctInteractionDays} day(s); personal generations ${r.legacy.personalModeGenerations}; eligible-in-past canon [${r.legacy.eligibleCanonFragmentIds.join(", ") || "none"}]; attested disclosures ${r.legacy.attestedDisclosureEvents}`
        : "    legacy: no relationship state"
    );
    lines.push(`    new: rapportBand ${p.rapportBand} (${p.rapportPolicyVersion ?? "-"}); personalRung ${p.personalRung} (${p.rungPolicyVersion ?? "-"}); cursor ${p.entitlementCursor ?? "none"}`);
    lines.push(`    evidence (${p.evidenceTotal}): ${Object.entries(p.evidenceByCategoryKind).map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
    lines.push(`    entitlements: unused ${p.entitlements.unused}, reserved ${p.entitlements.reserved}, consumed ${p.entitlements.consumed}`);
    lines.push(`    disclosed (new ledger): [${p.disclosedFragmentIds.join(", ") || "none"}] across ${p.ledgerEntryCount} ledger row(s)`);
    lines.push(`    latest: evidence occurred ${p.latest.evidenceOccurredAt ?? "-"}, recognized ${p.latest.evidenceRecognizedAt ?? "-"}; minted ${p.latest.entitlementMintedAt ?? "-"}; consumed ${p.latest.entitlementConsumedAt ?? "-"}; ledger ${p.latest.ledgerAt ?? "-"}`);
    lines.push(`    ON ENABLE: ${r.dormantProgressionWouldActivate ? "DORMANT PROGRESSION BECOMES ACTIVE — " + r.dormantReasons.join("; ") : "no dormant progression; starts from zero"}${r.legacyStateNotCarriedOver ? "  ** legacy access / possible prior disclosures are NOT carried over **" : ""}`);
  }
  lines.push("");
  lines.push("## Decision required (this report does not choose)");
  for (const option of CONTINUITY_DECISION_OPTIONS) lines.push(`- ${option.summary}`);
  return lines.join("\n");
}
