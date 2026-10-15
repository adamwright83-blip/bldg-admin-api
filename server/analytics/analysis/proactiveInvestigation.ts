import {
  analyzeBusinessData,
  connectedCustomerReceipt,
  PROACTIVE_ANALYSIS_BUDGET_MS,
  type BusinessAnalysisEvidence,
} from "./analyzeBusinessData";

/**
 * Scheduled research shares a tenant-wide, per-process hourly attempt budget.
 * Same-objective callers reuse the same promise/result; different objectives
 * do not inherit unrelated evidence. Failures also consume a slot to prevent
 * repeated paid calls during upstream outages.
 *
 * This is a process-local ceiling, not a distributed lease. The existing
 * persisted strategic diagnosis provides cross-request reuse; deployments with
 * multiple independent replicas need a shared durable lease for a global cap.
 */
export const PROACTIVE_RESEARCH_REUSE_MS = 60 * 60 * 1000;
const MAX_TRACKED_TENANTS = 1000;
type Request = {
  tenantId: string;
  objective: string | null;
  now: Date;
  timeZone: string;
};
type Attempt = {
  startedAt: number;
  objective: string;
  result: Promise<BusinessAnalysisEvidence | null>;
};

export function createProactiveResearchGate() {
  const attempts = new Map<string, Attempt>();

  return async function investigate(
    input: Request,
    analyze: typeof analyzeBusinessData = analyzeBusinessData,
    sourceReceipt: typeof connectedCustomerReceipt = connectedCustomerReceipt
  ): Promise<BusinessAnalysisEvidence | null> {
    const objective = input.objective?.trim();
    if (!input.tenantId.trim() || !objective) return null;
    const nowMs = input.now.getTime();

    // Bounded bookkeeping: evict only expired budgets, never active ones.
    for (const [tenant, attempt] of attempts)
      if (nowMs - attempt.startedAt >= PROACTIVE_RESEARCH_REUSE_MS)
        attempts.delete(tenant);
    const existing = attempts.get(input.tenantId);
    if (existing)
      return existing.objective === objective ? existing.result : null;
    if (attempts.size >= MAX_TRACKED_TENANTS) return null;

    const result = (async (): Promise<BusinessAnalysisEvidence | null> => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        PROACTIVE_ANALYSIS_BUDGET_MS
      );
      try {
        const analysis = await Promise.race([
          analyze({
            ...input,
            question: `Investigate the connected business evidence most relevant to this operator objective: ${objective.slice(0, 2000)}. Choose the question and calculations yourself. Return evidence and missing information only.`,
            proactive: true,
            budgetMs: PROACTIVE_ANALYSIS_BUDGET_MS,
            signal: controller.signal,
          }),
          new Promise<null>(resolve =>
            controller.signal.addEventListener("abort", () => resolve(null), {
              once: true,
            })
          ),
        ]);
        if (analysis?.kind === "evidence") return analysis;
        return await sourceReceipt({
          tenantId: input.tenantId,
          now: input.now,
          timeZone: input.timeZone,
        });
      } catch {
        return sourceReceipt({
          tenantId: input.tenantId,
          now: input.now,
          timeZone: input.timeZone,
        }).catch(() => null);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    })();

    attempts.set(input.tenantId, {
      startedAt: nowMs,
      objective,
      result,
    });
    return result;
  };
}

/** Shared by strategic preparation and morning-readiness research. */
export const investigateForPreparation = createProactiveResearchGate();
