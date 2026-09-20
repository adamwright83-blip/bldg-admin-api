/**
 * Source coverage: may Claire speak an unqualified whole-business number?
 *
 * WHY THIS EXISTS. `LedgerCompleteness` answers "did the query throw?", which is a different
 * question. On 2026-09-20 a real phone call ran against a tenant with no data at all. Both
 * loaders returned successfully with zero rows, so `failedSources` was empty, `completeness`
 * was `"complete"`, and Claire said "Paid revenue in the last 30 days is $0.00 across 0 orders"
 * with total confidence.
 *
 * FIVE DISTINCT QUESTIONS, deliberately not collapsed into one flag:
 *   1. EXPECTED   — does this question need this source at all? (question-relative)
 *   2. CONNECTED  — is the integration actually wired up for this tenant right now?
 *   3. READ       — did it load on this request?
 *   4. FRESH      — is the source up to the checkpoint its real schedule requires?
 *   5. COVERED    — does evidence prove the exact requested interval and event basis?
 *
 * CleanCloud membership is resolved from the live browser-sync tenant/store binding first, then
 * the SaaS import connection, with historical rows only as legacy membership evidence. None of
 * those signals is allowed to masquerade as interval coverage. Native Goldline orders are the
 * system of record and are bound whenever that table can be read, including a legitimate zero-row
 * tenant.
 */
import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
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

export type SourceCoverageBasis =
  | "economic_event"
  | "orders_created";

export type SourceCoverageRange = {
  /** Inclusive business-local dates. */
  from: string;
  to: string;
  completedAt: Date;
  basis: SourceCoverageBasis;
  provenance: "browser_sync_receipt" | "reconciled_import" | "test_fixture";
};

export type SourceAttempt = {
  at: Date;
  outcome: string;
  rangeFrom: string | null;
  rangeTo: string | null;
};

export type SourceEvidence = {
  state: SourceBindingState;
  /** Most recent successful integration activity. This is health evidence, NOT range coverage. */
  lastSuccessAt: Date | null;
  /** Exact intervals whose semantics are actually proven by receipts. */
  coverageRanges: SourceCoverageRange[];
  /** Latest recorded attempt, for diagnostics and stale-path evidence. */
  latestAttempt: SourceAttempt | null;
  /** True for Goldline's own records, which cannot lag behind themselves. */
  isSystemOfRecord: boolean;
};

export type LedgerSourceBindings = Record<LedgerSource, SourceBindingState>;
export type LedgerSourceEvidence = Record<LedgerSource, SourceEvidence>;

const UNKNOWN_SOURCE: SourceEvidence = {
  state: "unknown",
  lastSuccessAt: null,
  coverageRanges: [],
  latestAttempt: null,
  isSystemOfRecord: false,
};
export const UNKNOWN_BINDINGS: LedgerSourceBindings = { laundry_butler: "unknown", cleancloud: "unknown" };
export const UNKNOWN_EVIDENCE: LedgerSourceEvidence = {
  laundry_butler: { ...UNKNOWN_SOURCE, isSystemOfRecord: true },
  cleancloud: UNKNOWN_SOURCE,
};

/**
 * A source counts as present for the business when it is wired up OR has history. `legacy_history`
 * is deliberately NOT collapsed into `bound`: it proves the source belongs to the business without
 * pretending the feed is alive today or that any requested interval is complete.
 */
export function isPresent(state: SourceBindingState): boolean {
  return state === "bound" || state === "legacy_history";
}

/**
 * GUMBALL's actual contract: one automatic Orders (Sales) pull each day at 18:00 Los Angeles.
 * A run gets an explicit one-hour execution grace. Before today's checkpoint is due, yesterday
 * is the latest date the source is expected to have covered; after the grace, today is required.
 * This replaces the old rolling 36-hour heuristic.
 */
export const GUMBALL_TIME_ZONE = "America/Los_Angeles";
export const GUMBALL_DAILY_HOUR = 18;
export const GUMBALL_EXECUTION_GRACE_MINUTES = 60;

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function validYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function expectedCleanCloudCoverageThrough(now: Date): string {
  const today = formatInTimeZone(now, GUMBALL_TIME_ZONE, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, GUMBALL_TIME_ZONE, "HH"));
  const minute = Number(formatInTimeZone(now, GUMBALL_TIME_ZONE, "mm"));
  const checkpointMinutes =
    GUMBALL_DAILY_HOUR * 60 + GUMBALL_EXECUTION_GRACE_MINUTES;
  return hour * 60 + minute >= checkpointMinutes ? today : addDaysYmd(today, -1);
}

export function rangesCover(
  ranges: readonly SourceCoverageRange[],
  input: { from: string; to: string; basis: SourceCoverageBasis }
): boolean {
  if (input.to < input.from) return true;
  const relevant = ranges
    .filter(range => range.basis === input.basis && range.to >= input.from && range.from <= input.to)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  let cursor = input.from;
  for (const range of relevant) {
    if (range.to < cursor) continue;
    if (range.from > cursor) return false;
    cursor = addDaysYmd(range.to, 1);
    if (cursor > input.to) return true;
  }
  return cursor > input.to;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function coverageRangesFromReceiptRows(rows: readonly Row[]): SourceCoverageRange[] {
  const ranges: SourceCoverageRange[] = [];
  for (const row of rows) {
    const receipt = parseJsonRecord(row.receiptJson);
    if (!receipt || receipt.status === "cancelled") continue;
    const from = receipt.from;
    const to = receipt.to;
    const completedAt = toDate(receipt.completedAt ?? row.createdAt);
    if (!validYmd(from) || !validYmd(to) || !completedAt || to < from) continue;

    // Browser sync currently imports Orders (Sales). Its selected date interval is an
    // ORDER-CREATED interval. It is deliberately NOT labelled economic_event coverage:
    // the receipt itself warns that older orders/later corrections outside the selection
    // can be missed even when their payment date falls inside a revenue question.
    ranges.push({
      from,
      to,
      completedAt,
      basis: "orders_created",
      provenance: "browser_sync_receipt",
    });
  }
  return ranges;
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
    if (Array.isArray(result)) {
      // mysql2 returns [rows, fields]; some Drizzle adapters return rows directly.
      if (Array.isArray(result[0])) return result[0] as Row[];
      return result as Row[];
    }
    return (result as { rows?: Row[] })?.rows ?? [];
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
 *   3. successful browser-sync receipts — exact selected ranges and completion times.
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
  /** Most recent historical paid order attributed to CleanCloud. */
  historyAt: Date | null;
  /** Exact successful browser-sync receipt ranges. */
  coverageRanges?: SourceCoverageRange[];
  latestAttempt?: SourceAttempt | null;
}): SourceEvidence {
  const coverageRanges = input.coverageRanges ?? [];
  const receiptSuccessAt = latest(...coverageRanges.map(range => range.completedAt));
  const liveSuccess = latest(
    input.syncBinding?.lastSuccessAt ?? null,
    input.saasConnection?.lastImportedAt ?? null,
    receiptSuccessAt
  );
  const common = {
    coverageRanges,
    latestAttempt: input.latestAttempt ?? null,
    isSystemOfRecord: false as const,
  };
  if (input.syncBinding) {
    return { ...common, state: "bound", lastSuccessAt: liveSuccess };
  }
  if (input.saasConnection) {
    const status = input.saasConnection.status;
    const state: SourceBindingState =
      status === "connected" ? "bound" : status === "configured" ? "configured" : "disconnected";
    return { ...common, state, lastSuccessAt: liveSuccess };
  }
  if (input.historyAt) {
    return { ...common, state: "legacy_history", lastSuccessAt: liveSuccess };
  }
  return { ...common, state: "absent", lastSuccessAt: liveSuccess };
}

export async function loadLedgerSourceEvidence(tenantId: string, nowMs = Date.now()): Promise<LedgerSourceEvidence> {
  const cached = cache.get(tenantId);
  if (cached && nowMs - cached.at < CACHE_TTL_MS) return cached.evidence;

  const db = await getDb().catch(() => null);
  if (!db) return UNKNOWN_EVIDENCE;

  const [connectionRows, syncBindingRows, receiptRows, attemptRows, nativeRows, cleancloudRows] = await Promise.all([
    rows(db, sql`select \`providerKey\`, \`status\`, \`lastImportedAt\` from \`dayforge_saas_import_connections\` where \`tenantId\` = ${tenantId}`),
    rows(db, sql`select \`storeId\`, \`lastSuccessAt\` from \`cleancloud_browser_sync_bindings\` where \`tenantId\` = ${tenantId} limit 1`),
    rows(db, sql`select \`receiptJson\`, \`createdAt\` from \`cleancloud_browser_sync_receipts\` where \`tenantId\` = ${tenantId} order by \`createdAt\` desc limit 2000`),
    rows(db, sql`select \`createdAt\`, \`outcome\`, \`rangeFrom\`, \`rangeTo\` from \`cleancloud_browser_sync_attempts\` where \`tenantId\` = ${tenantId} order by \`createdAt\` desc limit 1`),
    rows(db, sql`select max(\`paidAt\`) as \`last\` from \`orders\` where COALESCE(\`tenantId\`, 'default') = ${tenantId} and \`paid\` = 1`),
    rows(db, sql`select max(COALESCE(\`paymentDateUtc\`, \`paidDateUtc\`)) as \`last\` from \`cleancloud_paid_orders\` where \`tenantId\` = ${tenantId}`),
  ]);

  const historyOf = (result: Row[] | "error") => (result === "error" ? "error" : toDate(result[0]?.last));

  // Native orders ARE Goldline's system of record. A successful empty read is a real empty
  // source, not evidence that the source is "unbound"; only a failed probe makes its state unknown.
  const nativeHistory = historyOf(nativeRows);
  const laundry_butler: SourceEvidence =
    nativeHistory === "error"
      ? { ...UNKNOWN_SOURCE, isSystemOfRecord: true }
      : {
          state: "bound",
          lastSuccessAt: nativeHistory,
          coverageRanges: [],
          latestAttempt: null,
          isSystemOfRecord: true,
        };

  const ccHistory = historyOf(cleancloudRows);
  const coverageRanges = receiptRows === "error" ? [] : coverageRangesFromReceiptRows(receiptRows);
  const attemptRow = attemptRows === "error" ? undefined : attemptRows[0];
  const latestAttempt: SourceAttempt | null = attemptRow && toDate(attemptRow.createdAt)
    ? {
        at: toDate(attemptRow.createdAt)!,
        outcome: String(attemptRow.outcome ?? ""),
        rangeFrom: validYmd(attemptRow.rangeFrom) ? attemptRow.rangeFrom : null,
        rangeTo: validYmd(attemptRow.rangeTo) ? attemptRow.rangeTo : null,
      }
    : null;
  let cleancloud: SourceEvidence;
  if (ccHistory === "error" && syncBindingRows === "error" && receiptRows === "error") {
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
      historyAt: ccHistory === "error" ? null : ccHistory,
      coverageRanges,
      latestAttempt,
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
  /** Every source this question needs is present, semantically complete for the claim, and was read. */
  | { kind: "provable" }
  /** Sources this question needs are not part of this business (or are disconnected). */
  | { kind: "unbound"; sources: LedgerSource[] }
  /** Current-period source is behind the checkpoint that is due under its actual schedule. */
  | { kind: "stale"; sources: LedgerSource[] }
  /** A closed requested interval has gaps in proven receipt coverage. */
  | { kind: "range_gap"; sources: LedgerSource[] }
  /** Available receipts cover a different event basis than the business claim requires. */
  | { kind: "semantic_gap"; sources: LedgerSource[] }
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
  period?: { start: string; end: string } | null;
  now?: Date;
  /** Paid-order analytics are economic-event dated, not order-created dated. */
  basis?: SourceCoverageBasis;
}): CoverageVerdict {
  const now = input.now ?? new Date();
  const basis = input.basis ?? "economic_event";
  const unreadable = input.required.filter(s => input.failedSources.includes(s) || !input.loadedSources.includes(s));
  if (unreadable.length) return { kind: "unreadable", sources: unreadable };
  const unknown = input.required.filter(s => input.evidence[s].state === "unknown");
  if (unknown.length) return { kind: "unknown", sources: unknown };
  const missing = input.required.filter(s => !isPresent(input.evidence[s].state));
  if (missing.length) return { kind: "unbound", sources: missing };

  const imported = input.required.filter(s => !input.evidence[s].isSystemOfRecord);
  if (!imported.length) return { kind: "provable" };

  if (!input.period) return { kind: "unknown", sources: imported };

  const today = formatInTimeZone(now, GUMBALL_TIME_ZONE, "yyyy-MM-dd");
  const isCurrent = input.period.end >= today;
  const requiredEnd = isCurrent
    ? expectedCleanCloudCoverageThrough(now)
    : input.period.end;

  if (isCurrent) {
    // Source health is independent of the business claim's event basis. Before today's run is due,
    // yesterday's successful receipt proves the path is on schedule; after the grace, today's
    // successful receipt is required. A recent timestamp without coverage of that checkpoint is
    // not enough.
    const stale = imported.filter(source => {
      const ranges = input.evidence[source].coverageRanges;
      return !ranges.some(range => range.from <= requiredEnd && range.to >= requiredEnd);
    });
    if (stale.length) return { kind: "stale", sources: stale };
  }

  const requiredRange = { from: input.period.start, to: requiredEnd, basis };

  const semanticGap = imported.filter(source => {
    const ranges = input.evidence[source].coverageRanges;
    if (!ranges.length) return false;
    return !ranges.some(range => range.basis === basis);
  });
  if (semanticGap.length) return { kind: "semantic_gap", sources: semanticGap };

  const notCovered = imported.filter(source =>
    !rangesCover(input.evidence[source].coverageRanges, requiredRange)
  );
  if (notCovered.length) {
    return { kind: isCurrent ? "stale" : "range_gap", sources: notCovered };
  }

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
      return `I have history from ${sources}, but the scheduled coverage due by now is missing, so I won't call that a zero.`;
    case "range_gap":
      return `I have records from ${sources}, but I can't prove they cover the full period you asked about, so I won't call that a zero.`;
    case "semantic_gap":
      return `I can see ${sources} Orders (Sales) history, but that feed is selected by order date rather than proving every payment event in the period, so I won't call that a complete zero.`;
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
      return `The scheduled ${sources} coverage due by now is missing, so that figure may be behind and isn't a confirmed whole-business total.`;
    case "range_gap":
      return `I can't prove ${sources} covers the full period you asked about, so that's partial rather than a confirmed whole-business total.`;
    case "semantic_gap":
      return `${sources} Orders (Sales) is selected by order date, while this business figure is dated by payment events. I can report what is in Goldline, but I can't honestly call it exhaustive whole-business coverage.`;
    case "unknown":
      return `I can't confirm ${sources} ${verdict.sources.length === 1 ? "is" : "are"} connected, so that may not be the whole business.`;
    case "unreadable":
    default:
      return `I couldn't read ${sources} just now, so that's not the whole-business total.`;
  }
}
