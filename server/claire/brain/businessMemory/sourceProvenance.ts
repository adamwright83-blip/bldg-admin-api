/**
 * Structural provenance: WHO WROTE THIS ROW?
 *
 * Display text is not provenance. A row is not test data because its name contains
 * "CODEX", and it is not production data because its name looks tidy. The durable
 * signal is the write path: `identityKey`, `providerName`, `providerAccountId` — the
 * columns whoever inserted the row was obliged to fill in.
 *
 * Four classes, and an explicit policy for each:
 *
 *   operator          real business data. Admitted.
 *   test_fixture      written by a test/fixture/sandbox writer. Never admitted.
 *   verification      written by a production verifier. Never admitted.
 *   unknown_legacy    predates provenance columns. See the policy below.
 *
 * LEGACY POLICY. Rows with no provenance columns at all cannot be classified
 * structurally. Excluding them would hide genuine business data; admitting them blindly
 * would resurrect old test rows that the current display-name filter catches. So for
 * those rows ONLY, a name heuristic still applies as an explicitly-marked compatibility
 * shim. It is a last resort, it is never consulted for a row that has real provenance,
 * and it is the piece to delete once provenance is backfilled and proven.
 */

export type SourceClass = "operator" | "test_fixture" | "verification" | "unknown_legacy";

export type RowProvenance = {
  name?: string | null;
  accountType?: string | null;
  providerName?: string | null;
  providerAccountId?: string | null;
  identityKey?: string | null;
  /** Explicit per-row markers some writers set. */
  fixture?: boolean;
  synthetic?: boolean;
};

/** Writers that exist to verify production, not to run it. */
const VERIFICATION_PROVIDER = /^(?:production-verifier|verifier|healthcheck)$/i;

/** Writers that belong to tests, fixtures and sandboxes. */
const TEST_PROVIDER = /^(?:sandbox|e2e|qa|fixture|test-harness|seed|demo)$/i;

/** Identity-key namespaces reserved for non-production data. */
const TEST_IDENTITY = /^(?:sandbox|test|qa|e2e|fixture|demo|seed):/i;

/** Account types that name a non-production account outright. */
const TEST_ACCOUNT_TYPE = /(?:^|[_\s-])(?:test|qa|demo|sandbox|fixture|e2e)(?:$|[_\s-])/i;

/**
 * LEGACY COMPATIBILITY SHIM — display text, used only when a row carries no
 * provenance at all. Remove once provenance is backfilled; see the header.
 */
const LEGACY_TEST_NAME = /\bSAFE TO ARCHIVE\b|\bE2E\b|\bCODEX\b/i;

function hasStructuralProvenance(row: RowProvenance): boolean {
  return Boolean(row.providerName || row.identityKey || row.accountType || row.fixture || row.synthetic);
}

/**
 * Classify a row by how it was written.
 *
 * Explicit markers win, then identity namespace, then provider, then account type.
 * The name is consulted last and only for rows with nothing else to go on.
 */
export function classifySource(row: RowProvenance | null | undefined): SourceClass {
  if (!row) return "unknown_legacy";

  if (row.fixture === true || row.synthetic === true) return "test_fixture";

  const identityKey = row.identityKey?.trim();
  if (identityKey && TEST_IDENTITY.test(identityKey)) return "test_fixture";

  const provider = row.providerName?.trim();
  if (provider) {
    if (VERIFICATION_PROVIDER.test(provider)) return "verification";
    if (TEST_PROVIDER.test(provider)) return "test_fixture";
    // A named, non-test provider is a real integration writing real data.
    return "operator";
  }

  const accountType = row.accountType?.trim();
  if (accountType && TEST_ACCOUNT_TYPE.test(accountType)) return "test_fixture";

  if (hasStructuralProvenance(row)) return "operator";

  // Nothing structural to go on.
  if (row.name && LEGACY_TEST_NAME.test(row.name)) return "test_fixture";
  return "unknown_legacy";
}

/**
 * May this row reach the authorized operator's evidence bundle?
 *
 * `unknown_legacy` is admitted: hiding real business data is the worse failure, and the
 * legacy shim above has already removed the rows we can recognise. Callers that care
 * can ask `classifySource` directly and qualify what they say.
 */
export function admitsToOperatorEvidence(row: RowProvenance | null | undefined): boolean {
  const sourceClass = classifySource(row);
  return sourceClass === "operator" || sourceClass === "unknown_legacy";
}

/** True when a row's classification rests on the legacy name shim rather than columns. */
export function classifiedByLegacyNameOnly(row: RowProvenance | null | undefined): boolean {
  if (!row) return false;
  if (hasStructuralProvenance(row)) return false;
  return Boolean(row.name && LEGACY_TEST_NAME.test(row.name));
}
