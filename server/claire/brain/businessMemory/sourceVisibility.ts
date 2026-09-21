/**
 * Write-path provenance filter at the Business Memory evidence boundary.
 * Adapted from PR #192 `sourceVisibility.ts`. Display names are not provenance.
 */

export type AccountProvenance = {
  name?: string | null;
  accountType?: string | null;
  providerName?: string | null;
  identityKey?: string | null;
};

export type SourceVisibility = "operator" | "test";

const TEST_PROVIDER = /^(?:production-verifier|sandbox|e2e|qa|fixture|test-harness)$/i;
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

export function isAuthorizedProductionOperator(input: { tenantId: string; operatorUserId: string }): boolean {
  return input.tenantId === "default" && (input.operatorUserId === "adam-admin" || input.operatorUserId === "adam");
}

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

/**
 * Classify a candidate evidence payload. Never uses spoken titles or CODEX/E2E name substrings.
 */
export function isOperatorVisibleEvidencePayload(payload: {
  accountType?: string | null;
  providerName?: string | null;
  identityKey?: string | null;
  fixture?: boolean;
  synthetic?: boolean;
  evidence?: Array<Record<string, unknown>> | null;
}): boolean {
  if (payload.fixture === true || payload.synthetic === true) return false;
  return isOperatorVisibleMissionSnapshot(payload);
}
