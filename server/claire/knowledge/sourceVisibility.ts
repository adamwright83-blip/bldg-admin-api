/**
 * Provenance / source-visibility boundary for Claire's business readers.
 *
 * Goldline records real commercial work in the same tables that verification,
 * E2E, sandbox, and QA write paths also touch. Claire must never present those
 * test-origin rows to a real operator (tenant `default`, actor `adam-admin`)
 * as if they were the business.
 *
 * Classification uses write-path provenance stamped on the record:
 * provider identity, account type, sandbox identity keys, and fixture flags
 * in opportunity evidence. Display names and Day Line titles are not provenance.
 */

export type AccountProvenance = {
  name?: string | null;
  accountType?: string | null;
  providerName?: string | null;
  identityKey?: string | null;
};

export type SourceVisibility = "operator" | "test";

export type DerivedWorkMetadata = {
  claireProactive?: boolean;
  sourceKind?: "sales_follow_up" | "dormant_recovery";
  accountProvenance?: AccountProvenance | null;
};

/** Providers used only by verification / sandbox writers. */
const TEST_PROVIDER = /^(?:production-verifier|sandbox|e2e|qa|fixture|test-harness)$/i;
/** Account types the write path uses for non-real prospects. */
const TEST_ACCOUNT_TYPE = /(?:^|[_\s-])(?:test|qa|demo|sandbox|fixture|e2e)(?:$|[_\s-])/i;

export function sourceVisibilityForAccount(account: AccountProvenance | null | undefined): SourceVisibility {
  if (!account) return "operator";
  if (account.identityKey && /^(?:sandbox:|test:|qa:|e2e:|fixture:)/i.test(account.identityKey)) return "test";
  if (account.providerName && TEST_PROVIDER.test(account.providerName.trim())) return "test";
  if (account.accountType && TEST_ACCOUNT_TYPE.test(account.accountType)) return "test";
  return "operator";
}

export function isOperatorVisibleAccount(account: AccountProvenance | null | undefined): boolean {
  return sourceVisibilityForAccount(account) === "operator";
}

/**
 * Mission snapshots carry the account they were created from. A fixture flag
 * in opportunity evidence is also write-path provenance, not a spoken-note filter.
 */
export function isOperatorVisibleMissionSnapshot(snapshot: {
  name?: string | null;
  accountType?: string | null;
  providerName?: string | null;
  identityKey?: string | null;
  evidence?: Array<Record<string, unknown>> | null;
} | null | undefined): boolean {
  if (!snapshot) return true;
  if (!isOperatorVisibleAccount(snapshot)) return false;
  if (snapshot.evidence?.some(item => item.fixture === true || item.synthetic === true || item.qa === true)) {
    return false;
  }
  return true;
}

export function isOperatorVisibleFollowUp(input: {
  account?: AccountProvenance | null;
  missionAccount?: AccountProvenance | null;
}): boolean {
  return isOperatorVisibleAccount(input.account ?? input.missionAccount ?? null);
}

/**
 * Real authorized-operator Claire surfaces. A different tenant or a synthetic
 * actor is outside this protection by isolation; this flag is the production
 * operator that must never see test-origin business rows.
 */
export function isAuthorizedProductionOperator(input: { tenantId: string; operatorUserId: string }): boolean {
  return input.tenantId === "default" && (input.operatorUserId === "adam-admin" || input.operatorUserId === "adam");
}

/**
 * Join-shaped commercial rows (board, Field Today, Dayforge, account history).
 * Test-origin commercial work is never operator-visible business.
 */
export function filterOperatorVisibleCommercial<T extends AccountProvenance>(rows: readonly T[]): T[] {
  return rows.filter(row => isOperatorVisibleAccount(row));
}

/**
 * Day Line / proactive derived work. Provenance lives on metadata stamped at
 * write time — not on the human-readable title.
 *
 * Unstamped claire-proactive sales follow-ups fail closed for the production
 * operator. Dormant recoveries are not commercial-account derived.
 */
export function isOperatorVisibleDerivedWork(
  meta: DerivedWorkMetadata | null | undefined,
  operator: { tenantId: string; operatorUserId: string }
): boolean {
  if (!meta?.claireProactive) return true;
  if (meta.sourceKind === "dormant_recovery") return true;
  if (meta.accountProvenance) return isOperatorVisibleAccount(meta.accountProvenance);
  if (meta.sourceKind === "sales_follow_up") {
    return !isAuthorizedProductionOperator(operator);
  }
  return !isAuthorizedProductionOperator(operator);
}

export function isOperatorVisibleFieldCommercial(
  item: { accountProvenance?: AccountProvenance | null; kind?: string },
  operator: { tenantId: string; operatorUserId: string }
): boolean {
  if (item.accountProvenance) {
    if (!isOperatorVisibleAccount(item.accountProvenance) && isAuthorizedProductionOperator(operator)) {
      return false;
    }
    return isOperatorVisibleAccount(item.accountProvenance);
  }
  return true;
}
