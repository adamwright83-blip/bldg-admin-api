import { ProviderError } from "../providerFetch";

/**
 * What research actually looked at, and what it couldn't. A source that failed, wasn't granted, or was cut short by
 * a budget is recorded as such, so nothing downstream reads its silence as "no activity". Entries hold queries,
 * windows, counts and provider status codes only: never a token, a message body or a cell value.
 */
export type ResearchSource = "gmail" | "drive" | "docs" | "sheets" | "calendar" | "public_web";

export type CoverageStatus =
  /** read, and something came back */
  | "ok"
  /** read, and genuinely nothing matched */
  | "empty"
  /** the person didn't grant this product */
  | "not_granted"
  /** the provider refused or failed: absence of results means nothing */
  | "failed"
  /** read, but bounded: more existed than was read */
  | "partial"
  /** left out on purpose (sensitive personal content) */
  | "excluded"
  /** not read because the run's budget was spent */
  | "skipped_budget";

export type CoverageEntry = {
  source: ResearchSource;
  /** what was done: "search", "sent_window", "read_thread", "read_document", "read_spreadsheet", ... */
  operation: string;
  /** the Gmail/Drive query, or the item read (an id, never content) */
  target: string;
  status: CoverageStatus;
  items: number;
  /** the time window the operation covered, when it had one (ISO) */
  window: { from: string; to: string } | null;
  /** a provider status/reason code, e.g. "403 SERVICE_DISABLED" */
  reason: string | null;
  at: string;
};

export type SourceCoverage = {
  source: ResearchSource;
  /** complete: every attempt read; partial: some bounded or failed; failed: nothing could be read */
  state: "complete" | "partial" | "failed" | "not_granted" | "not_attempted";
  attempts: number;
  failures: number;
  items: number;
  reasons: string[];
};

export const SOURCES: readonly ResearchSource[] = ["gmail", "drive", "docs", "sheets", "calendar", "public_web"];

/** A provider failure as a short code, never its message body. */
export function failureReason(error: unknown): string {
  if (error instanceof ProviderError) {
    const code = error.message.match(/\(([A-Za-z_]{2,64})\)/)?.[1];
    return code ? `${error.status} ${code}` : String(error.status);
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "error";
}

export class CoverageLedger {
  private readonly entries: CoverageEntry[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  record(entry: Omit<CoverageEntry, "at" | "reason" | "window"> & { reason?: string | null; window?: { from: Date; to: Date } | null }): void {
    this.entries.push({
      ...entry,
      target: entry.target.slice(0, 300),
      reason: entry.reason ?? null,
      window: entry.window ? { from: entry.window.from.toISOString(), to: entry.window.to.toISOString() } : null,
      at: this.now().toISOString(),
    });
  }

  all(): readonly CoverageEntry[] {
    return this.entries;
  }

  /** Restore from a stored run, so a later re-investigation knows what was already covered. */
  static from(entries: readonly CoverageEntry[], now?: () => Date): CoverageLedger {
    const ledger = new CoverageLedger(now);
    ledger.entries.push(...entries);
    return ledger;
  }

  summary(): SourceCoverage[] {
    return SOURCES.map(source => {
      const mine = this.entries.filter(entry => entry.source === source);
      const failures = mine.filter(entry => entry.status === "failed").length;
      const bounded = mine.some(entry => entry.status === "partial" || entry.status === "skipped_budget");
      const granted = mine.filter(entry => entry.status !== "not_granted");
      let state: SourceCoverage["state"];
      if (!mine.length) state = "not_attempted";
      else if (!granted.length) state = "not_granted";
      else if (failures === granted.length) state = "failed";
      else if (failures || bounded) state = "partial";
      else state = "complete";
      return {
        source,
        state,
        attempts: mine.length,
        failures,
        items: mine.reduce((sum, entry) => sum + entry.items, 0),
        reasons: [...new Set(mine.map(entry => entry.reason).filter((reason): reason is string => Boolean(reason)))].slice(0, 8),
      };
    });
  }

  /**
   * Whether `source` was successfully searched across [from, to): the union of windows of operations that read
   * without failing covers the whole span. Used to tell "nothing happened then" from "we didn't look".
   */
  covered(source: ResearchSource, from: Date, to: Date): boolean {
    const spans = this.entries
      .filter(entry => entry.source === source && entry.window && (entry.status === "ok" || entry.status === "empty" || entry.status === "partial"))
      .map(entry => [Date.parse(entry.window!.from), Date.parse(entry.window!.to)] as const)
      .sort((a, b) => a[0] - b[0]);
    let reach = from.getTime();
    for (const [start, end] of spans) {
      if (start > reach) break;
      reach = Math.max(reach, end);
      if (reach >= to.getTime()) return true;
    }
    return reach >= to.getTime();
  }

  /** Whether any read of `source` failed (or wasn't granted): the source's picture is incomplete. */
  incomplete(source: ResearchSource): boolean {
    const state = this.summary().find(item => item.source === source)?.state;
    return state === "failed" || state === "partial" || state === "not_granted";
  }
}
