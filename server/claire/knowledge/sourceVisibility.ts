/**
 * Provenance / source-visibility boundary for Claire's business readers.
 *
 * Goldline records real commercial work in the same tables that verification,
 * E2E, sandbox, and QA write paths also touch. Claire must never present those
 * test-origin rows to a real operator (tenant `default`, actor `adam-admin`)
 * as if they were the business.
 *
 * This is NOT a blacklist of fixture display names or follow-up note strings.
 * Classification uses write-path provenance already stamped on the record:
 * provider identity, account type, sandbox identity keys, and the labeling
 * convention the verification writer itself uses (`SAFE TO ARCHIVE` / `E2E` /
 * `CODEX`) so the row can be found and archived.
 */

export type AccountProvenance = {
  name?: string | null;
  accountType?: string | null;
  providerName?: string | null;
  identityKey?: string | null;
};

export type SourceVisibility = "operator" | "test";

/** Providers used only by verification / sandbox writers. */
const TEST_PROVIDER = /^(?:production-verifier|sandbox|e2e|qa|fixture|test-harness)$/i;
/** Account types the write path uses for non-real prospects. */
const TEST_ACCOUNT_TYPE = /(?:^|[_\s-])(?:test|qa|demo|sandbox|fixture|e2e)(?:$|[_\s-])/i;
/**
 * Label the verification writer stamps so a human can archive the row. This is
 * the write path's own provenance mark, not a list of customer names.
 */
const WRITE_PATH_TEST_LABEL = /\bSAFE TO ARCHIVE\b|\bE2E\b|\bCODEX\b/i;

export function sourceVisibilityForAccount(account: AccountProvenance | null | undefined): SourceVisibility {
  if (!account) return "operator";
  if (account.identityKey && /^(?:sandbox:|test:|qa:|e2e:|fixture:)/i.test(account.identityKey)) return "test";
  if (account.providerName && TEST_PROVIDER.test(account.providerName.trim())) return "test";
  if (account.accountType && TEST_ACCOUNT_TYPE.test(account.accountType)) return "test";
  if (account.name && WRITE_PATH_TEST_LABEL.test(account.name)) return "test";
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
