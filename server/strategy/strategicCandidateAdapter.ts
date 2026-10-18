import type { StrategicDiagnosis } from "../../shared/strategicIntelligence";
import type { WeeklyGrowthCandidate } from "../../shared/weeklyGrowthCandidates";
import { workThreadCandidateId } from "../../shared/workThread";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { latestStrategicDiagnosis } from "./strategicStore";

export function diagnosisCandidates(
  d: StrategicDiagnosis,
  now: Date
): WeeklyGrowthCandidate[] {
  if (
    d.quality.structuralErrors.length ||
    d.quality.judgment === "revise" ||
    !Number.isFinite(Date.parse(d.generatedAt)) ||
    Date.parse(d.generatedAt) > now.getTime() ||
    now.getTime() - Date.parse(d.generatedAt) > 24 * 3600000
  )
    return [];
  return d.actions.map(a => ({
    // The Work Thread is the candidate's identity, so an hourly re-diagnosis
    // (a new diagnosis id) is the same candidate, objective and lessons.
    // Pre-thread diagnoses keep their diagnosis-scoped id.
    id: a.workThreadId ? workThreadCandidateId(a.workThreadId) : `${d.id}:${a.id}`,
    ...(a.workThreadId ? { workThreadId: a.workThreadId } : {}),
    ...(a.opportunity?.kind === "strategy_opportunity" && a.opportunity.area ? { scopeArea: a.opportunity.area } : {}),
    sourceKind: "strategy_diagnosis",
    motion: a.motion,
    title: a.title,
    objective: a.completionCondition,
    alreadyInFlight: false,
    observedDueDate: null,
    sourceRefs: [
      {
        sourceKind: "strategy_diagnosis",
        sourceType: "strategic_diagnosis",
        sourceId: d.id,
      },
    ],
    provenance: {
      reader: "StrategyEngine.strategicDiagnosis",
      sourceType: "strategic_diagnosis",
      sourceIds: [d.id, ...a.evidenceRefs],
      observedAt: now.toISOString(),
    },
    prep: { leadDays: 0, condition: null, feasibleWithinHorizon: true },
    fit: { pocketKind: "any", minimumMinutes: null },
    observedSignals: [
      {
        label: "strategic_driver",
        value: a.driver,
        source: d.id,
        sourceIds: a.evidenceRefs,
      },
      // The operator's stated method is challenged by evidence. Mission
      // Director carries it on this work and never ranks the alternative.
      ...(d.challenge
        ? [
            {
              label: "strategic_challenge",
              value: d.challenge.id,
              source: d.id,
              sourceIds: d.challenge.evidenceAgainst.map(e => e.ref),
            },
          ]
        : []),
    ],
    assumptions: [
      {
        text: a.hypothesis,
        source: d.id,
        recordedAt: d.generatedAt,
        confidence: "low",
        evidenceClass: "hypothesis",
      },
    ],
    confidence: "low",
    rankReasons: ["LOW_CONFIDENCE_ASSUMPTION"],
  }));
}
export async function readStrategicCandidates(input: {
  tenantId: string;
  operatorUserId: string;
  now: Date;
}): Promise<WeeklyGrowthCandidate[]> {
  const resolved = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorUserId },
    subsystem: "strategy.candidate_adapter",
  });
  if (!resolved.ok) return [];
  const d = await latestStrategicDiagnosis(resolved.identity);
  return d ? diagnosisCandidates(d, input.now) : [];
}
