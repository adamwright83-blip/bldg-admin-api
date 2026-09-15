import { and, desc, eq, ne } from "drizzle-orm";
import {
  commercialPipelineRecords,
  commercialVisitOutcomes,
} from "../../drizzle/schema";
import type { MissionSalesBriefFact } from "../../shared/missionSalesBrief";
import type { CommercialMission } from "../../shared/commercialMission";
import { getCommercialMissionFieldState } from "../commercialMissions/commercialMissionFieldService";
import { getDb } from "../db";

/**
 * Deterministic evidence assembly — runs BEFORE any generative reasoning.
 * Every fact keeps its provenance and source reference; nothing here
 * flattens uncertainty. This is the "authoritative business evidence"
 * input at the top of the MissionSalesBrief truth pipeline.
 */
export type MissionSalesBriefEvidence = {
  tenantId: string;
  missionId: number;
  accountId: number | null;
  mission: CommercialMission;
  currentVisitOutcome: {
    outcome: string;
    notes: string | null;
    decisionMakerStatus: string;
    followUpAt: string | null;
    recordedAt: string | null;
  } | null;
  /** Other missions for the same account, most recent first, excluding the current mission. */
  priorOutcomes: MissionSalesBriefFact[];
  knownFacts: MissionSalesBriefFact[];
  /** The evidence-freshness watermark: the newest timestamp any fact here depends on. */
  evidenceThrough: string;
};

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "follow_up":
      return "a follow-up was requested";
    case "no_contact":
      return "no contact was made";
    case "no_decision":
      return "no decision was reached";
    default:
      return outcome;
  }
}

/** Best-effort account id for a mission — via the pipeline record created at mission build time, if one exists. */
async function resolveAccountId(input: {
  tenantId: string;
  missionId: number;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ accountId: commercialPipelineRecords.accountId })
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.missionId, input.missionId)
      )
    )
    .limit(1);
  return row?.accountId ?? null;
}

/** Prior visit outcomes for OTHER missions tied to the same account — real history, never invented. */
async function listPriorAccountOutcomes(input: {
  tenantId: string;
  accountId: number;
  excludeMissionId: number;
}): Promise<MissionSalesBriefFact[]> {
  const db = await getDb();
  if (!db) return [];
  const priorMissionIds = await db
    .select({ missionId: commercialPipelineRecords.missionId })
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.accountId, input.accountId),
        ne(commercialPipelineRecords.missionId, input.excludeMissionId)
      )
    );
  if (!priorMissionIds.length) return [];
  const facts: MissionSalesBriefFact[] = [];
  for (const { missionId } of priorMissionIds) {
    const [outcome] = await db
      .select()
      .from(commercialVisitOutcomes)
      .where(
        and(
          eq(commercialVisitOutcomes.tenantId, input.tenantId),
          eq(commercialVisitOutcomes.missionId, missionId)
        )
      )
      .orderBy(desc(commercialVisitOutcomes.createdAt))
      .limit(1);
    if (!outcome) continue;
    facts.push({
      text: `A prior visit (mission ${missionId}) recorded: ${outcomeLabel(outcome.outcome)}.${outcome.notes ? ` Notes: ${outcome.notes.slice(0, 200)}` : ""}`,
      provenance: "authoritative_evidence",
      sourceReference: `commercial_visit_outcomes:${missionId}`,
    });
  }
  return facts;
}

export async function assembleMissionSalesBriefEvidence(input: {
  tenantId: string;
  missionId: number;
}): Promise<MissionSalesBriefEvidence | null> {
  const state = await getCommercialMissionFieldState(input);
  if (!state) return null;
  const mission = state.mission as CommercialMission;
  const accountId = await resolveAccountId(input);

  const currentVisitOutcome = state.visitOutcome
    ? {
        outcome: state.visitOutcome.outcome,
        notes: state.visitOutcome.notes ?? null,
        decisionMakerStatus: state.visitOutcome.decisionMakerStatus,
        followUpAt: state.visitOutcome.followUpAt ?? null,
        recordedAt: state.visitOutcome.createdAt ?? null,
      }
    : null;

  const priorOutcomes = accountId
    ? await listPriorAccountOutcomes({
        tenantId: input.tenantId,
        accountId,
        excludeMissionId: input.missionId,
      })
    : [];

  const knownFacts: MissionSalesBriefFact[] = [];
  if (mission.opportunity?.primarySignal) {
    knownFacts.push({
      text: mission.opportunity.primarySignal,
      provenance: "authoritative_evidence",
      sourceReference: `commercial_missions:${input.missionId}:opportunity`,
    });
  }
  if (currentVisitOutcome) {
    knownFacts.push({
      text: `This mission's own visit already recorded: ${outcomeLabel(currentVisitOutcome.outcome)}.${currentVisitOutcome.notes ? ` ${currentVisitOutcome.notes.slice(0, 200)}` : ""}`,
      provenance: "operator_attested",
      sourceReference: `commercial_visit_outcomes:${input.missionId}`,
    });
  }

  const evidenceThrough = [
    mission.updatedAt,
    state.field?.arrivedAt ?? null,
    state.field?.departedAt ?? null,
    currentVisitOutcome?.followUpAt ?? null,
    currentVisitOutcome?.recordedAt ?? null,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? mission.updatedAt;

  return {
    tenantId: input.tenantId,
    missionId: input.missionId,
    accountId,
    mission,
    currentVisitOutcome,
    priorOutcomes,
    knownFacts,
    evidenceThrough,
  };
}
