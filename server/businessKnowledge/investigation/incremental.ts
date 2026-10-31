import { gmailAfter, type GoogleResearch } from "../../firstTenMinutes/research/googleResearch";
import type { CoverageLedger } from "../../firstTenMinutes/research/coverage";
import { latestFinishedRun, type KnowledgeScope } from "../store";
import type { InvestigatorModel } from "./interpretation";
import { INCREMENTAL_BUDGET, investigate, type InvestigationResult } from "./loop";

/**
 * Keeping the understanding current after onboarding without re-reading a life's history: check cheaply whether
 * anything changed since the last investigation's watermark (new sent mail, changed documents), and only then run a
 * small investigation over what is new. Corrections survive: reconciliation never lets an inference replace the
 * person's answer, and a resolved question is asked again only when new evidence conflicts with it.
 *
 * Never called per Claire conversation: at most once per `minIntervalMs` per journey, and the run lease makes
 * concurrent callers a no-op.
 */
export const REINVESTIGATE_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

export type ReinvestigateOutcome = { ran: boolean; reason: string; result?: InvestigationResult };

export async function reinvestigateIfChanged(
  scope: KnowledgeScope,
  deps: { research: GoogleResearch; ledger: CoverageLedger; model: InvestigatorModel; ownerEmail: string; now: () => Date; minIntervalMs?: number }
): Promise<ReinvestigateOutcome> {
  const last = await latestFinishedRun(scope);
  if (!last) return { ran: false, reason: "there is no investigation to update yet" };
  const now = deps.now();
  const interval = deps.minIntervalMs ?? REINVESTIGATE_MIN_INTERVAL_MS;
  if (last.finishedAt && now.getTime() - last.finishedAt.getTime() < interval) return { ran: false, reason: "checked recently" };
  const since = last.watermarkAt ?? last.startedAt;

  const sent = await deps.research.countMail(`in:sent ${gmailAfter(since)}`);
  const files = await deps.research.recentFiles({ since, limit: 10 });
  if (sent === null && files === null) return { ran: false, reason: "couldn't check for changes (sources unavailable)" };
  const changedFiles = (files ?? []).length;
  if (!sent && !changedFiles) return { ran: false, reason: `nothing new since ${since.toISOString().slice(0, 10)}` };

  const result = await investigate(scope, {
    research: deps.research,
    ledger: deps.ledger,
    model: deps.model,
    ownerEmail: deps.ownerEmail,
    now: deps.now,
    since,
    budget: INCREMENTAL_BUDGET,
    trigger: `${sent ?? 0} new sent message(s), ${changedFiles} changed file(s) since ${since.toISOString().slice(0, 10)}`,
  });
  return { ran: result.status !== "busy", reason: result.stoppedBecause, result };
}
