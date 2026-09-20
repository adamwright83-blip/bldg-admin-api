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

export type SourceBindingState = "bound" | "unbound" | "unknown";

/** What we actually learned about one source, kept separate rather than collapsed. */
export type SourceEvidence = {
  /** Explicit integration state, when the tenant has a connection row at all. */
  connection: "connected" | "disconnected" | "none";
  /** Has this tenant ever recorded data through this source? */
  observed: boolean;
  /** Most recent arrival through this source, when known. Reported, not yet enforced. */
  lastActivityAt: Date | null;
  state: SourceBindingState;
};

export type LedgerSourceBindings = Record<LedgerSource, SourceBindingState>;
export type LedgerSourceEvidence = Record<LedgerSource, SourceEvidence>;

const UNKNOWN_SOURCE: SourceEvidence = { connection: "none", observed: false, lastActivityAt: null, state: "unknown" };
export const UNKNOWN_BINDINGS: LedgerSourceBindings = { laundry_butler: "unknown", cleancloud: "unknown" };
export const UNKNOWN_EVIDENCE: LedgerSourceEvidence = { laundry_butler: UNKNOWN_SOURCE, cleancloud: UNKNOWN_SOURCE };

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

function deriveState(connection: SourceEvidence["connection"], observed: boolean, failed: boolean): SourceBindingState {
  if (failed) return "unknown";
  // An explicitly disabled integration is unbound even when historical rows survive.
  if (connection === "disconnected") return "unbound";
  if (connection === "connected") return "bound";
  return observed ? "bound" : "unbound";
}

export async function loadLedgerSourceEvidence(tenantId: string, now = Date.now()): Promise<LedgerSourceEvidence> {
  const cached = cache.get(tenantId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.evidence;

  const db = await getDb().catch(() => null);
  if (!db) return UNKNOWN_EVIDENCE;

  const connectionRows = await rows(
    db,
    sql`select \`providerKey\`, \`status\`, \`lastImportedAt\` from \`dayforge_saas_import_connections\` where \`tenantId\` = ${tenantId}`
  );
  const nativeRows = await rows(db, sql`select max(\`paidAt\`) as \`last\` from \`orders\` where COALESCE(\`tenantId\`, 'default') = ${tenantId} and \`paid\` = 1`);
  const cleancloudRows = await rows(db, sql`select max(COALESCE(\`paymentDateUtc\`, \`paidDateUtc\`)) as \`last\` from \`cleancloud_paid_orders\` where \`tenantId\` = ${tenantId}`);

  const observedFor = (result: Row[] | "error"): { observed: boolean; last: Date | null; failed: boolean } => {
    if (result === "error") return { observed: false, last: null, failed: true };
    const raw = result[0]?.last;
    const last = raw ? new Date(raw as string) : null;
    return { observed: Boolean(last && !Number.isNaN(last.getTime())), last, failed: false };
  };

  const build = (source: LedgerSource, observedResult: Row[] | "error"): SourceEvidence => {
    const { observed, last, failed } = observedFor(observedResult);
    let connection: SourceEvidence["connection"] = "none";
    let lastImported: Date | null = null;
    if (connectionRows !== "error") {
      const match = connectionRows.find(row => PROVIDER_KEYS[source].includes(String(row.providerKey ?? "").toLowerCase()));
      if (match) {
        const status = String(match.status ?? "");
        connection = status === "connected" || status === "configured" ? "connected" : "disconnected";
        lastImported = match.lastImportedAt ? new Date(match.lastImportedAt as string) : null;
      }
    }
    const connectionFailed = connectionRows === "error" && !observed;
    return {
      connection,
      observed,
      lastActivityAt: lastImported ?? last,
      state: deriveState(connection, observed, failed || connectionFailed),
    };
  };

  const evidence: LedgerSourceEvidence = {
    laundry_butler: build("laundry_butler", nativeRows),
    cleancloud: build("cleancloud", cleancloudRows),
  };
  cache.set(tenantId, { at: now, evidence });
  return evidence;
}

export async function loadLedgerSourceBindings(tenantId: string, now = Date.now()): Promise<LedgerSourceBindings> {
  const evidence = await loadLedgerSourceEvidence(tenantId, now);
  return { laundry_butler: evidence.laundry_butler.state, cleancloud: evidence.cleancloud.state };
}

/** Tests only. */
export function resetSourceBindingCacheForTests(): void {
  cache.clear();
}

export type CoverageVerdict =
  /** Every source this question needs is bound and was read: an unqualified answer is honest. */
  | { kind: "provable" }
  /** The business does not use sources this question needs. */
  | { kind: "unbound"; sources: LedgerSource[] }
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
 * May Claire state this aggregate without qualifying its scope? Applies to ANY unqualified
 * whole-business figure, not only a zero: "$500" reported as the whole business while CleanCloud
 * is missing is the same epistemic error as "$0", just less visually alarming.
 */
export function coverageVerdict(input: {
  required: readonly LedgerSource[];
  bindings: LedgerSourceBindings;
  loadedSources: readonly LedgerSource[];
  failedSources: readonly LedgerSource[];
}): CoverageVerdict {
  const unreadable = input.required.filter(source => input.failedSources.includes(source) || !input.loadedSources.includes(source));
  if (unreadable.length) return { kind: "unreadable", sources: unreadable };
  const unknown = input.required.filter(source => input.bindings[source] === "unknown");
  if (unknown.length) return { kind: "unknown", sources: unknown };
  const unbound = input.required.filter(source => input.bindings[source] === "unbound");
  if (unbound.length) return { kind: "unbound", sources: unbound };
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
    case "unknown":
      return `I can't confirm ${sources} ${verdict.sources.length === 1 ? "is" : "are"} connected, so that may not be the whole business.`;
    case "unreadable":
    default:
      return `I couldn't read ${sources} just now, so that's not the whole-business total.`;
  }
}
