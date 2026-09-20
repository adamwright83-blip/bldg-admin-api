/**
 * Source binding: does this business actually USE a given paid-order source?
 *
 * WHY THIS EXISTS. `LedgerCompleteness` answers "did the query throw?", which is not the same
 * question. On 2026-09-20 a real phone call ran against a tenant with no data at all. Both
 * loaders returned successfully with zero rows, so `failedSources` was empty, `completeness`
 * was `"complete"`, and Claire said "Paid revenue in the last 30 days is $0.00 across 0 orders"
 * with total confidence. Nothing in the stack could tell "you made no sales" apart from
 * "this business has no sales sources connected".
 *
 * A source is BOUND when there is positive evidence the tenant has ever recorded anything
 * through it. UNBOUND means the check ran and found nothing — the tenant does not use that
 * source, so an empty window proves nothing about the business. UNKNOWN means the check itself
 * could not run, which must never license a zero either.
 *
 * Binding is deliberately evidence-based rather than a config flag: Goldline has no
 * per-tenant integration registry today, and inventing one here would be a second source of
 * truth. If such a registry is added later, this module is the single place to read it from.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";
import type { LedgerSource } from "./businessLineage";
import { LEDGER_SOURCES } from "./paidOrderLedger";

export type SourceBindingState = "bound" | "unbound" | "unknown";

export type LedgerSourceBindings = Record<LedgerSource, SourceBindingState>;

export const UNKNOWN_BINDINGS: LedgerSourceBindings = {
  laundry_butler: "unknown",
  cleancloud: "unknown",
};

/** Bindings change rarely; a short cache keeps this off the live voice path. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; bindings: LedgerSourceBindings }>();

async function probe(query: () => Promise<unknown[]>): Promise<SourceBindingState> {
  try {
    const rows = await query();
    return rows.length > 0 ? "bound" : "unbound";
  } catch (error) {
    // A missing table means the source was never provisioned here: that is genuinely unbound.
    if (isMysqlMissingTableError(error)) return "unbound";
    return "unknown";
  }
}

export async function loadLedgerSourceBindings(
  tenantId: string,
  now = Date.now()
): Promise<LedgerSourceBindings> {
  const cached = cache.get(tenantId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.bindings;

  let bindings: LedgerSourceBindings;
  try {
    const db = await getDb();
    if (!db) return UNKNOWN_BINDINGS;
    const [laundry_butler, cleancloud] = await Promise.all([
      probe(() => db.execute(sql`select 1 from \`orders\` where COALESCE(\`tenantId\`, 'default') = ${tenantId} limit 1`) as Promise<unknown[]>),
      probe(() => db.execute(sql`select 1 from \`cleancloud_paid_orders\` where \`tenantId\` = ${tenantId} limit 1`) as Promise<unknown[]>),
    ]);
    bindings = { laundry_butler, cleancloud };
  } catch {
    return UNKNOWN_BINDINGS;
  }
  cache.set(tenantId, { at: now, bindings });
  return bindings;
}

/** Tests only. */
export function resetSourceBindingCacheForTests(): void {
  cache.clear();
}

export type ZeroVerdict =
  /** Every source this question needs is bound and was read: an unqualified zero is a real fact. */
  | { kind: "provable" }
  /** The business does not use the sources this question needs; an empty window says nothing. */
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
 * May Claire state an unqualified zero? Fails closed: anything other than "every required
 * source is bound and was read" withholds the bare number.
 */
export function zeroVerdict(input: {
  required: readonly LedgerSource[];
  bindings: LedgerSourceBindings;
  loadedSources: readonly LedgerSource[];
  failedSources: readonly LedgerSource[];
}): ZeroVerdict {
  const unreadable = input.required.filter(source => input.failedSources.includes(source) || !input.loadedSources.includes(source));
  if (unreadable.length) return { kind: "unreadable", sources: unreadable };
  const unknown = input.required.filter(source => input.bindings[source] === "unknown");
  if (unknown.length) return { kind: "unknown", sources: unknown };
  const unbound = input.required.filter(source => input.bindings[source] === "unbound");
  // Every required source unbound = this business has no sales universe at all.
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

/**
 * What Claire says instead of a bare zero. Restrained and specific: it names why the number is
 * not trustworthy rather than implying the business did nothing.
 */
export function speakUnprovableZero(verdict: Exclude<ZeroVerdict, { kind: "provable" }>): string {
  const sources = describeSources(verdict.sources);
  switch (verdict.kind) {
    case "unbound":
      return `I can't answer that from this business's records — ${sources} ${verdict.sources.length === 1 ? "isn't" : "aren't"} connected here, so I have nothing to count. That's a gap in what I can see, not a zero.`;
    case "unknown":
      return `I can't confirm ${sources} ${verdict.sources.length === 1 ? "is" : "are"} connected right now, so I won't give you a number that might just mean I'm blind to it.`;
    case "unreadable":
    default:
      return `I couldn't read ${sources} just now, so I can't give you a whole-business number. I won't report that as zero.`;
  }
}
