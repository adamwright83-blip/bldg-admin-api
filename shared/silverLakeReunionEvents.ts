/**
 * Silver Lake reunion-quest events: what the server stores, and how a visit reads them back.
 * docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md.
 *
 * Append-only. `item_found` and `reunited` are fiction progress. `passed` is the operator's explicit decision not to
 * write to this customer for now. None of them is an outreach state: nothing here says a message was sent, scheduled
 * or handed off, and the Letter Desk, Day Line and outbox never read it.
 */

export const REUNION_EVENT_KINDS = ["item_found", "reunited", "passed"] as const;
export type ReunionEventKind = (typeof REUNION_EVENT_KINDS)[number];

/** "Pass on Mei for now": the pass holds this long, then the customer's quest waits for a decision again. */
export const REUNION_PASS_HOLDS_DAYS = 7;
/** Fiction progress older than this is forgotten, so a customer who lapses again gets a fresh errand. */
export const REUNION_PROGRESS_HOLDS_DAYS = 45;

export const REUNION_TEMPLATE_ID_RE = /^[a-z][a-z0-9_]{2,63}$/;

export type ReunionEvent = {
  customerId: string;
  templateId: string;
  kind: ReunionEventKind;
  createdAt: string; // ISO
};

export type ReunionProgress = {
  passes: Set<string>;
  found: Set<string>;
  reunited: Set<string>;
  /** the template a customer's progress was made under, so a returning visit keeps the same errand */
  templateByCustomer: Map<string, string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function projectReunionProgress(events: readonly ReunionEvent[], now: Date = new Date()): ReunionProgress {
  const progress: ReunionProgress = { passes: new Set(), found: new Set(), reunited: new Set(), templateByCustomer: new Map() };
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of ordered) {
    const age = now.getTime() - new Date(e.createdAt).getTime();
    if (!Number.isFinite(age) || age < -DAY_MS) continue;
    if (e.kind === "passed") {
      if (age <= REUNION_PASS_HOLDS_DAYS * DAY_MS) progress.passes.add(e.customerId);
      continue;
    }
    if (age > REUNION_PROGRESS_HOLDS_DAYS * DAY_MS) continue;
    progress.templateByCustomer.set(e.customerId, e.templateId);
    if (e.kind === "item_found") progress.found.add(e.customerId);
    if (e.kind === "reunited") {
      progress.found.add(e.customerId);
      progress.reunited.add(e.customerId);
    }
  }
  return progress;
}
