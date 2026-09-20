/**
 * Source coverage: may Claire speak an unqualified whole-business number?
 *
 * WHY THIS EXISTS. `LedgerCompleteness` answers "did the query throw?", which is a different
 * question. On 2026-09-20 a real phone call ran against a tenant with no data at all. Both
 * loaders returned successfully with zero rows, so `failedSources` was empty, `completeness`
 * was `"complete"`, and Claire said "Paid revenue in the last 30 days is $0.00 across 0 orders"
 * with total confidence.
 *
 * FOUR DISTINCT QUESTIONS, deliberately not collapsed into one flag:
 *   1. EXPECTED   — does this question need this source at all? (question-relative)
 *   2. CONNECTED  — is the integration actually wired up for this tenant right now?
 *   3. READ       — did it load on this request?
 *   4. FRESH      — how recently did data last arrive through it?
 *
 * Connection is read from `dayforge_saas_import_connections` (tenant + providerKey + status)
 * where a row exists, because an explicitly disabled integration must not look connected just
 * because old rows survive, and a newly connected one with zero orders must not look
 * disconnected. Where no connection row exists — which is the case for businesses that predate
 * the SaaS onboarding flow, including the primary operator's — observed historical data is the
 * fallback evidence. Absence of both is UNBOUND: the business does not use that source, so an
 * empty window proves nothing about it.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";
import type { LedgerSource } from "./businessLineage";
import { LEDGER_SOURCES } from "./paidOrderLedger";

/**
 * Binding: does this source belong to the business at all, and on what authority?
 * Deliberately distinguishes "we have old rows from it" from "it is wired up today".
 */
export type SourceBindingState =
  /** An authoritative integration record pairs this tenant to this source. */
  | "bound"
  /** Historical data proves the source belongs to the business, but no live integration record. */
  | "legacy_history"
  /** An integration row exists but has never actually connected. */
  | "configured"
  /** Explicitly disabled or erroring. */
  | "disconnected"
  /** No evidence of any kind: this business does not use the source. */
  | "absent"
  /** The probe itself failed. */
  | "unknown";

/**
 * Health: is what we can read from it CURRENT enough to answer this question?
 * Only meaningful for imported sources. Native Goldline orders are the system of record —
 * there is no sync lag to be stale about — so they are `current` whenever they read.
 */
export type SourceHealth = "current" | "stale" | "unknown" | "not_applicable";

export type SourceEvidence = {
  state: SourceBindingState;
  /** Most recent SUCCESSFUL sync/import through this source, when known. */
  lastSuccessAt: Date | null;
  /** True for Goldline's own records, which cannot lag behind themselves. */
  isSystemOfRecord: boolean;
};

export type LedgerSourceBindings = Record<LedgerSource, SourceBindingState>;
export type LedgerSourceEvidence = Record<LedgerSource, SourceEvidence>;

const UNKNOWN_SOURCE: SourceEvidence = { state: "unknown", lastSuccessAt: null, isSystemOfRecord: false };
export const UNKNOWN_BINDINGS: LedgerSourceBindings = { laundry_butler: "unknown", cleancloud: "unknown" };
export const UNKNOWN_EVIDENCE: LedgerSourceEvidence = {
  laundry_butler: { ...UNKNOWN_SOURCE, isSystemOfRecord: true },
  cleancloud: UNKNOWN_SOURCE,
};

/**
 * A source counts as present for the business when it is wired up OR has history. `legacy_history`
 * is deliberately NOT collapsed into `bound`: it proves the source belongs to the business (so an
 * empty window is a real zero for tenants that predate the SaaS onboarding flow) without pretending
 * the feed is alive today.
 */
export function isPresent(state: SourceBindingState): boolean {
  return state === "bound" || state === "legacy_history";
}

/**
 * Freshness is question-relative, not one global threshold. Data for a CLOSED past period is
 * complete once any successful sync happened after that period ended — asking about August does
 * not require a sync this morning. A period that runs up to now requires a recent sync.
 */
export const RECENT_SYNC_TOLERANCE_MS = 36 * 60 * 60 * 1000;

export function sourceHealthFor(
  evidence: SourceEvidence,
  period: { endExclusiveUtc: Date } | null,
  now: Date
): SourceHealth {
  if (evidence.isSystemOfRecord) return "not_applicable";
  if (evidence.state === "unknown") return "unknown";
  if (!evidence.lastSuccessAt) return evidence.state === "legacy_history" ? "stale" : "unknown";
  const periodEnd = period?.endExclusiveUtc ?? now;
  if (periodEnd.getTime() <= now.getTime()) {
    // Closed period: a sync after the window closed covers it.
    if (evidence.lastSuccessAt.getTime() >= periodEnd.getTime()) return "current";
  }
  return now.getTime() - evidence.lastSuccessAt.getTime() <= RECENT_SYNC_TOLERANCE_MS ? "current" : "stale";
}

/** `providerKey` values in `dayforge_saas_import_connections` that map to a ledger source. */
const PROVIDER_KEYS: Record<LedgerSource, readonly string[]> = {
  cleancloud: ["cleancloud"],
  laundry_butler: ["laundry_butler", "native", "stripe"],
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; evidence: LedgerSourceEvidence }>();

type Row = Record<string, unknown>;

async function rows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, query: ReturnType<typeof sql>): Promise<Row[] | "error"> {
  try {
    const result = (await db.execute(query)) as unknown;
    return Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] })?.rows ?? []);
  } catch (error) {
    // A missing table means the mechanism was never provisioned here, not that the read failed.
    if (isMysqlMissingTableError(error)) return [];
    return "error";
  }
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latest(...dates: Array<Date | null>): Date | null {
  return dates.filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

/**
 * CleanCloud health hierarchy, strongest evidence first:
 *   1. `cleancloud_browser_sync_bindings` — the tenant→store pairing GUMBALL writes, carrying
 *      `lastSuccessAt`. This is the live integration path for this business.
 *   2. `dayforge_saas_import_connections` — the SaaS onboarding path. `configured` is NOT
 *      `connected`: the schema distinguishes them and so do we.
 *   3. `cleancloud_import_batches` — successful import activity, used for freshness.
 *   4. historical paid-order rows — proves the source BELONGS to the business (needed for tenants
 *      that predate both integration paths) but never proves the feed is alive: `legacy_history`.
 */
/**
 * The CleanCloud hierarchy as a pure decision, so the precedence is testable without a database.
 * Strongest evidence wins; `configured` is never promoted to `connected`, and history alone is
 * never promoted to a live feed.
 */
export function deriveCleanCloudEvidence(input: {
  /** `cleancloud_browser_sync_bindings` row for this tenant, if any. */
  syncBinding: { lastSuccessAt: Date | null } | null;
  /** `dayforge_saas_import_connections` row for CleanCloud, if any. */
  saasConnection: { status: string; lastImportedAt: Date | null } | null;
  /** Most recent non-failed `cleancloud_import_batches` row. */
  importSuccessAt: Date | null;
  /** Most recent historical paid order attributed to CleanCloud. */
  historyAt: Date | null;
}): SourceEvidence {
  const syncSuccess = latest(input.syncBinding?.lastSuccessAt ?? null, input.importSuccessAt);
  if (input.syncBinding) return { state: "bound", lastSuccessAt: syncSuccess, isSystemOfRecord: false };
  if (input.saasConnection) {
    const status = input.saasConnection.status;
    const state: SourceBindingState =
      status === "connected" ? "bound" : status === "configured" ? "configured" : "disconnected";
    return { state, lastSuccessAt: latest(input.saasConnection.lastImportedAt, syncSuccess), isSystemOfRecord: false };
  }
  if (input.historyAt) return { state: "legacy_history", lastSuccessAt: syncSuccess, isSystemOfRecord: false };
  return { state: "absent", lastSuccessAt: null, isSystemOfRecord: false };
}

export async function loadLedgerSourceEvidence(tenantId: string, nowMs = Date.now()): Promise<LedgerSourceEvidence> {
  const cached = cache.get(tenantId);
  if (cached && nowMs - cached.at < CACHE_TTL_MS) return cached.evidence;

  const db = await getDb().catch(() => null);
  if (!db) return UNKNOWN_EVIDENCE;

  const [connectionRows, syncBindingRows, importBatchRows, nativeRows, cleancloudRows] = await Promise.all([
    rows(db, sql`select \`providerKey\`, \`status\`, \`lastImportedAt\` from \`dayforge_saas_import_connections\` where \`tenantId\` = ${tenantId}`),
    rows(db, sql`select \`storeId\`, \`lastSuccessAt\` from \`cleancloud_browser_sync_bindings\` where \`tenantId\` = ${tenantId} limit 1`),
    rows(db, sql`select max(\`createdAt\`) as \`last\` from \`cleancloud_import_batches\` where \`tenantId\` = ${tenantId} and \`importStatus\` <> 'failed'`),
    rows(db, sql`select max(\`paidAt\`) as \`last\` from \`orders\` where COALESCE(\`tenantId\`, 'default') = ${tenantId} and \`paid\` = 1`),
    rows(db, sql`select max(COALESCE(\`paymentDateUtc\`, \`paidDateUtc\`)) as \`last\` from \`cleancloud_paid_orders\` where \`tenantId\` = ${tenantId}`),
  ]);

  const historyOf = (result: Row[] | "error") => (result === "error" ? "error" : toDate(result[0]?.last));

  // Native orders ARE Goldline's records: present when any exist, never stale.
  const nativeHistory = historyOf(nativeRows);
  const laundry_butler: SourceEvidence =
    nativeHistory === "error"
      ? { ...UNKNOWN_SOURCE, isSystemOfRecord: true }
      : { state: nativeHistory ? "bound" : "absent", lastSuccessAt: nativeHistory, isSystemOfRecord: true };

  const ccHistory = historyOf(cleancloudRows);
  const importSuccess = historyOf(importBatchRows);
  let cleancloud: SourceEvidence;
  if (ccHistory === "error" && syncBindingRows === "error") {
    cleancloud = UNKNOWN_SOURCE;
  } else {
    const syncRow = syncBindingRows === "error" ? undefined : syncBindingRows[0];
    const saasRow =
      connectionRows === "error"
        ? undefined
        : connectionRows.find(row => PROVIDER_KEYS.cleancloud.includes(String(row.providerKey ?? "").toLowerCase()));
    cleancloud = deriveCleanCloudEvidence({
      syncBinding: syncRow ? { lastSuccessAt: toDate(syncRow.lastSuccessAt) } : null,
      saasConnection: saasRow ? { status: String(saasRow.status ?? ""), lastImportedAt: toDate(saasRow.lastImportedAt) } : null,
      importSuccessAt: importSuccess === "error" ? null : importSuccess,
      historyAt: ccHistory === "error" ? null : ccHistory,
    });
  }

  const evidence: LedgerSourceEvidence = { laundry_butler, cleancloud };
  cache.set(tenantId, { at: nowMs, evidence });
  return evidence;
}

/** Tests only. */
export function resetSourceBindingCacheForTests(): void {
  cache.clear();
}

export type CoverageVerdict =
  /** Every source this question needs is present, current enough, and was read. */
  | { kind: "provable" }
  /** Sources this question needs are not part of this business (or are disconnected). */
  | { kind: "unbound"; sources: LedgerSource[] }
  /** Present, but the feed is behind the window being asked about. */
  | { kind: "stale"; sources: LedgerSource[] }
  /** Binding could not be established, so absence cannot be distinguished from ignorance. */
  | { kind: "unknown"; sources: LedgerSource[] }
  /** A required source failed to load this time. */
  | { kind: "unreadable"; sources: LedgerSource[] };

/**
 * Which sources a question actually needs. A question scoped to one source ("how much came
 * through CleanCloud?") needs only that source; an unscoped whole-business question needs all
 * of them. Coverage is question-relative, never one global flag.
 */
export function requiredSourcesFor(scopedSources: readonly LedgerSource[] | null | undefined): LedgerSource[] {
  const scoped = (scopedSources ?? []).filter(source => LEDGER_SOURCES.includes(source));
  return scoped.length ? scoped : [...LEDGER_SOURCES];
}

/**
 * May Claire state this aggregate without qualifying its scope?
 *
 * Complete coverage means: expected source + authoritative binding + current enough for THIS
 * question + read successfully. "Had data once" is explicitly not enough — that would just be the
 * previous epistemic mistake wearing a new name.
 */
export function coverageVerdict(input: {
  required: readonly LedgerSource[];
  evidence: LedgerSourceEvidence;
  loadedSources: readonly LedgerSource[];
  failedSources: readonly LedgerSource[];
  period?: { endExclusiveUtc: Date } | null;
  now?: Date;
}): CoverageVerdict {
  const now = input.now ?? new Date();
  const unreadable = input.required.filter(s => input.failedSources.includes(s) || !input.loadedSources.includes(s));
  if (unreadable.length) return { kind: "unreadable", sources: unreadable };
  const unknown = input.required.filter(s => input.evidence[s].state === "unknown");
  if (unknown.length) return { kind: "unknown", sources: unknown };
  const missing = input.required.filter(s => !isPresent(input.evidence[s].state));
  if (missing.length) return { kind: "unbound", sources: missing };
  const stale = input.required.filter(s => {
    const health = sourceHealthFor(input.evidence[s], input.period ?? null, now);
    return health === "stale" || health === "unknown";
  });
  if (stale.length) return { kind: "stale", sources: stale };
  return { kind: "provable" };
}

const SOURCE_WORDS: Record<LedgerSource, string> = {
  laundry_butler: "Laundry Butler",
  cleancloud: "CleanCloud",
};

export function describeSources(sources: readonly LedgerSource[]): string {
  const names = sources.map(source => SOURCE_WORDS[source] ?? source);
  if (names.length <= 1) return names[0] ?? "that source";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What Claire says instead of a bare zero, when absence cannot be proven. */
export function speakUnprovableZero(verdict: Exclude<CoverageVerdict, { kind: "provable" }>): string {
  const sources = describeSources(verdict.sources);
  const isAre = verdict.sources.length === 1 ? "isn't" : "aren't";
  switch (verdict.kind) {
    case "unbound":
      return `I can't answer that from this business's records — ${sources} ${isAre} connected here, so I have nothing to count. That's a gap in what I can see, not a zero.`;
    case "stale":
      return `I have history from ${sources}, but I can't verify the feed is current, so I won't call that a zero.`;
    case "unknown":
      return `I can't confirm ${sources} ${verdict.sources.length === 1 ? "is" : "are"} connected right now, so I won't give you a number that might just mean I'm blind to it.`;
    case "unreadable":
    default:
      return `I couldn't read ${sources} just now, so I can't give you a whole-business number. I won't report that as zero.`;
  }
}

/**
 * Appended to a real but PARTIAL figure. The number is true for what was read; the caveat stops
 * it from passing as the whole business.
 */
export function speakPartialCoverage(verdict: Exclude<CoverageVerdict, { kind: "provable" }>): string {
  const sources = describeSources(verdict.sources);
  const isAre = verdict.sources.length === 1 ? "isn't" : "aren't";
  switch (verdict.kind) {
    case "unbound":
      return `That's only what I can see — ${sources} ${isAre} connected here, so treat it as partial, not the whole business.`;
    case "stale":
      return `I can't verify ${sources} ${verdict.sources.length === 1 ? "is" : "are"} current, so that may be behind and isn't a confirmed whole-business total.`;
    case "unknown":
      return `I can't confirm ${sources} ${verdict.sources.length === 1 ? "is" : "are"} connected, so that may not be the whole business.`;
    case "unreadable":
    default:
      return `I couldn't read ${sources} just now, so that's not the whole-business total.`;
  }
}
