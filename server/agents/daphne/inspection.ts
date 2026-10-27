/**
 * Read-only view of one operator's Daphne loop, for verifying it in production
 * without the phone: the compiled card, goals and preferences with the words that
 * set them, the macro goal that heads the week, decision/outcome counts, and the
 * last observations by source. Reads only; writes nothing except the card's own
 * card_compiled metric, which every card read already records.
 */
import { buildDaphneV2OperatorCard } from "./engine";
import { listDaphneInterventions } from "./interventionLedger";
import { listDaphneOutcomes } from "./outcomeLedger";
import { listDaphneObservations } from "./observationStore";
import { daphneSourceUtterance } from "./operatorCard";
import { listMacroGoalsForOperators } from "../../planning/macroGoalStore";
import { DAPHNE_DECISION_POINT_POLICY_VERSION, isDaphneDecisionPointsEnabled } from "./decisionPoints";

export async function inspectDaphneOperatorLoop(input: {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserIds: readonly string[];
  agentId?: string;
}) {
  const scope = { tenantId: input.tenantId, canonicalOperatorId: input.canonicalOperatorId };
  const [card, interventions, outcomes, observations, macroGoals] = await Promise.all([
    buildDaphneV2OperatorCard({ ...scope, agentId: input.agentId ?? "claire" }),
    listDaphneInterventions({ ...scope, limit: 500 }),
    listDaphneOutcomes({ ...scope, limit: 500 }),
    listDaphneObservations({ ...scope, limit: 20 }),
    listMacroGoalsForOperators({ tenantId: input.tenantId, operatorUserIds: input.operatorUserIds }).catch(() => []),
  ]);
  const count = <T,>(rows: T[], key: (row: T) => string) =>
    rows.reduce<Record<string, number>>((acc, row) => {
      const k = key(row);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  const decisionRows = interventions.filter(i => i.policyVersion === DAPHNE_DECISION_POINT_POLICY_VERSION);
  const valueOf = (v: unknown) => (v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v);
  return {
    generatedAt: new Date().toISOString(),
    decisionPointsEnabled: isDaphneDecisionPointsEnabled(input.tenantId),
    card,
    /** operator_macro_goals: the week's headline when one leads (repair plan §3). */
    macroGoals: macroGoals.map(g => ({
      id: g.id,
      objective: g.objective,
      metricKey: g.metricKey,
      targetValue: g.targetValue,
      status: g.status,
      createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt),
    })),
    /** Daphne operator_declared_goal rows: area focus sources, never the headline. */
    daphneGoals: card.goalSources,
    preferences: card.activePreferences,
    interventions: {
      total: interventions.length,
      decisionPointRows: decisionRows.length,
      byContextAndAction: count(interventions, i => `${i.contextKey}:${i.chosenAction}`),
      bySelectionMode: count(interventions, i => i.selectionMode),
      latest: interventions.slice(0, 5).map(i => ({
        id: i.id,
        decisionPointId: i.decisionPointId,
        chosenAction: i.chosenAction,
        selectionMode: i.selectionMode,
        selectionProbability: i.selectionProbability,
        policyVersion: i.policyVersion,
        windowMinutes: i.proximalOutcomeWindowMinutes,
        createdAt: i.createdAt,
      })),
    },
    outcomes: {
      total: outcomes.length,
      byMeasureAndValue: count(outcomes, o => `${o.measureKey}=${JSON.stringify(valueOf(o.value))}`),
      byEvidence: count(outcomes, o => `${o.evidenceClass}/${o.verificationStatus}`),
    },
    lastObservations: observations.map(o => ({
      id: o.id,
      occurredAt: o.occurredAt,
      sourceType: o.sourceType,
      observationKind: o.observationKind,
      verificationStatus: o.verificationStatus,
      utterance: daphneSourceUtterance(o),
      itemKinds: Array.isArray((o.payload as { items?: unknown })?.items)
        ? ((o.payload as { items: Array<{ kind?: string; instructionKind?: string; key?: string }> }).items).map(
            i => i.instructionKind ?? i.key ?? i.kind ?? "unknown"
          )
        : [],
    })),
  };
}
