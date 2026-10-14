import {
  analyzeBusinessData,
  PROACTIVE_ANALYSIS_BUDGET_MS,
  type BusinessAnalysisEvidence,
} from "./analyzeBusinessData";

/** Shared evidence capability, not a schedule, planner or ranking authority. */
export async function investigateForPreparation(
  input: {
    tenantId: string;
    objective: string | null;
    now: Date;
    timeZone: string;
  },
  analyze = analyzeBusinessData
): Promise<BusinessAnalysisEvidence | null> {
  if (!input.objective?.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROACTIVE_ANALYSIS_BUDGET_MS);
  try {
    const analysis = await Promise.race([
      analyze({
        ...input,
        question: `Investigate the connected business evidence most relevant to this operator objective: ${input.objective.slice(0, 2000)}. Choose the question and calculations yourself. Return evidence and missing information only.`,
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
    return analysis?.kind === "evidence" ? analysis : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
