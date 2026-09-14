import type {
  MissionSalesBrief,
  MissionSalesBriefFact,
} from "../../shared/missionSalesBrief";
import { assembleMissionSalesBriefEvidence } from "./evidenceAssembler";
import {
  listEligibleSalesIntel,
  selectRelevantSalesIntel,
} from "./salesIntelEligibility";
import {
  compileMissionSalesStrategy,
  STRATEGY_COMPILER_VERSION,
} from "./strategyCompiler";
import { getMissionSalesBriefStore } from "./store";

/**
 * ONE MISSION. ONE SALES BRIEF. This is the single generation entry point —
 * Claire and the field UI both call `ensureCurrentMissionSalesBrief`
 * (directly or via missionSalesBriefRouter) and get back the same
 * versioned artifact. Neither is allowed to compile its own strategy.
 */

function situationText(input: {
  knownFacts: MissionSalesBriefFact[];
  priorOutcomes: MissionSalesBriefFact[];
}): string {
  return [...input.knownFacts, ...input.priorOutcomes]
    .map(fact => fact.text)
    .join(" ")
    .toLowerCase();
}

async function generateNextVersion(input: {
  tenantId: string;
  missionId: number;
  previous: MissionSalesBrief | null;
  evidence: Awaited<ReturnType<typeof assembleMissionSalesBriefEvidence>>;
}): Promise<MissionSalesBrief | null> {
  const evidence = input.evidence;
  if (!evidence) return null;

  const eligible = await listEligibleSalesIntel();
  const intel = selectRelevantSalesIntel({
    eligible,
    situationText: situationText({
      knownFacts: evidence.knownFacts,
      priorOutcomes: evidence.priorOutcomes,
    }),
  });

  const strategy = await compileMissionSalesStrategy({
    tenantId: input.tenantId,
    evidence,
    knownFacts: evidence.knownFacts,
    intel,
  });

  const warnings: string[] = [];
  if (evidence.accountId == null) {
    warnings.push("No pipeline record links this mission to an account; prior-account history could not be checked.");
  }

  const brief: Omit<MissionSalesBrief, "id"> = {
    version: (input.previous?.version ?? 0) + 1,
    tenantId: input.tenantId,
    missionId: input.missionId,
    accountId: evidence.accountId,
    generatedAt: new Date().toISOString(),
    generatedFromEvidenceThrough: evidence.evidenceThrough,
    account: {
      name: evidence.mission.account.name,
      address: evidence.mission.account.address ?? null,
      accountType: evidence.mission.account.accountType ?? null,
    },
    mission: {
      missionType: evidence.mission.status,
      currentStatus: evidence.mission.status,
      objective: strategy.recommendedApproach.primaryObjective,
    },
    knownFacts: evidence.knownFacts,
    priorInteractions: evidence.priorOutcomes,
    priorOutcomes: evidence.priorOutcomes,
    relevantSignals: [],
    unknowns: strategy.unknowns,
    unresolvedQuestions: strategy.unknowns.map(unknown => unknown.question),
    recommendedApproach: strategy.recommendedApproach,
    salesIntel: {
      includedIntelIds: intel ? [intel.teachingId] : [],
      frameworkId: intel?.teachingId ?? null,
      rationale: intel?.rationale ?? null,
    },
    provenance: {
      sourceReferences: [
        ...evidence.knownFacts.map(fact => fact.sourceReference),
        ...evidence.priorOutcomes.map(fact => fact.sourceReference),
      ],
      verificationClasses: Array.from(
        new Set([
          ...evidence.knownFacts.map(fact => fact.provenance),
          ...evidence.priorOutcomes.map(fact => fact.provenance),
          "recommendation" as const,
        ])
      ),
    },
    source: strategy.source,
    compilerVersion: STRATEGY_COMPILER_VERSION,
    confidence: strategy.confidence,
    warnings,
    createdBy: "system",
    supersedesVersion: input.previous?.version ?? null,
  };

  return getMissionSalesBriefStore().insertVersion(brief);
}

/**
 * The evidence-staleness check that makes versioning automatic (Slice 13):
 * if the latest stored brief's evidence cutoff is at or after the mission's
 * current evidence watermark, it's still current and is returned as-is —
 * never mutated. Otherwise a new version is generated. New reality (a
 * confirmed visit outcome, a status change) naturally produces a new
 * version the next time this is called; nothing explicitly "invalidates"
 * a brief.
 */
export async function ensureCurrentMissionSalesBrief(input: {
  tenantId: string;
  missionId: number;
}): Promise<MissionSalesBrief | null> {
  const store = getMissionSalesBriefStore();
  const previous = await store.getLatest(input);

  const evidence = await assembleMissionSalesBriefEvidence(input);
  if (!evidence) return previous;

  if (
    previous &&
    new Date(previous.generatedFromEvidenceThrough).getTime() >=
      new Date(evidence.evidenceThrough).getTime()
  ) {
    return previous;
  }

  return generateNextVersion({ ...input, previous, evidence });
}

export async function getLatestMissionSalesBrief(input: {
  tenantId: string;
  missionId: number;
}): Promise<MissionSalesBrief | null> {
  return getMissionSalesBriefStore().getLatest(input);
}

export async function listMissionSalesBriefVersions(input: {
  tenantId: string;
  missionId: number;
}): Promise<MissionSalesBrief[]> {
  return getMissionSalesBriefStore().listVersions(input);
}
