import { CLAIRE_COMPILER_VERSION } from "./character/compiler";
import { CLAIRE_CHARACTER_VERSION } from "./character/characterDefinition";
import { getClaireRelationshipState } from "./character/relationshipState";
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  getClaireGenerationStats,
  type ClaireGenerationDiagnostic,
} from "./generationTelemetry";
import { writeClairePreDriveBrief } from "./reasoning";
import { previewWorkdayLoop } from "./workdayPlanService";
import { loadDailyCommand } from "./workdayCommandService";
import { detectWorkdaySession } from "../../shared/claireWorkday";
import { getTodayFeaturedOperation } from "../strategy/todayFeaturedService";
import { getLatestStrategySnapshot } from "../strategy/snapshotBuilder";

export async function assembleClaireVoiceCallContext(
  input: {
    tenantId: string;
    actorId: string;
    timeZone?: string;
    missionId?: number;
    dayDirectorActorId?: string;
  },
  dependencies: {
    assemble?: typeof assembleClaireDriveContext;
  } = {}
) {
  const assemble = dependencies.assemble ?? assembleClaireDriveContext;
  const context = await assemble({
    tenantId: input.tenantId,
    actorId: input.actorId,
    phase: "pre_drive",
    timeZone: input.timeZone,
    missionId: input.missionId,
  });
  try {
    const workday = await previewWorkdayLoop({
      tenantId: input.tenantId,
      actorId: input.dayDirectorActorId ?? input.actorId,
      context,
    });
    context.workday = {
      session: workday.session,
      eveningSpeak: workday.eveningSpeak,
      morningSpeak: workday.morningSpeak,
      tomorrowCount: workday.tomorrowDraft.length,
      deltaCount: workday.deltas.length,
      hasConfirmedPlan: Boolean(workday.confirmed),
    };
  } catch {
    context.workday = {
      session: detectWorkdaySession({
        fieldSalesDayState: context.clock?.fieldSalesDayState,
        daypart: context.clock?.daypart,
      }),
      eveningSpeak: "",
      morningSpeak: "",
      tomorrowCount: 0,
      deltaCount: 0,
      hasConfirmedPlan: false,
    };
  }
  try {
    context.workdayCommand = await loadDailyCommand({
      tenantId: input.tenantId,
      actorId: input.dayDirectorActorId ?? input.actorId,
      dayDirectorActorId: input.dayDirectorActorId ?? input.actorId,
      operatorUserId: input.actorId,
      businessDate: context.businessDate,
      timeZone: input.timeZone,
    });
  } catch {
    context.workdayCommand = null;
  }
  return context;
}

export async function generateClairePreDriveOutput(
  input: {
    tenantId: string;
    actorId: string;
    timeZone?: string;
    missionId?: number;
    dayDirectorActorId?: string;
  },
  dependencies: {
    assemble?: typeof assembleClaireDriveContext;
    writeBrief?: typeof writeClairePreDriveBrief;
  } = {}
) {
  const writeBrief = dependencies.writeBrief ?? writeClairePreDriveBrief;
  const context = await assembleClaireVoiceCallContext(input, dependencies);
  let diagnostic: ClaireGenerationDiagnostic | undefined;
  const brief = await writeBrief({
    tenantId: input.tenantId,
    context,
    onGeneration: value => {
      diagnostic = value;
    },
  });
  if (!diagnostic) {
    throw new Error("Claire generation completed without diagnostic metadata");
  }
  return { brief, context, diagnostic };
}

export async function previewClairePreDrive(
  input: {
    tenantId: string;
    actorId: string;
    timeZone?: string;
    missionId?: number;
    dayDirectorActorId?: string;
  },
  dependencies: Parameters<typeof generateClairePreDriveOutput>[1] = {}
) {
  const generated = await generateClairePreDriveOutput(input, dependencies);
  const relationshipState = await getClaireRelationshipState({
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
  });
  return {
    brief: generated.brief,
    source: generated.diagnostic.source,
    failureReason: generated.diagnostic.failureReason,
    generatedAt: generated.context.generatedAt,
    businessDate: generated.context.businessDate,
    generationStats: getClaireGenerationStats(input.tenantId),
    // Slice 1/2: which compiled Claire produced this line, and at what
    // relationship state — for the 30-day field-test review pass.
    characterVersion: CLAIRE_CHARACTER_VERSION,
    compilerVersion: CLAIRE_COMPILER_VERSION,
    disclosureTier: relationshipState.disclosureTier,
    relationshipDimensions: {
      professionalRespect: relationshipState.professionalRespect,
      reliability: relationshipState.reliability,
      disclosureSafety: relationshipState.disclosureSafety,
      familiarity: relationshipState.familiarity,
    },
    writesBusinessTruth: false as const,
    clock: generated.context.clock ?? null,
    macroGoal: generated.context.macroGoal
      ? {
          id: generated.context.macroGoal.id,
          objective: generated.context.macroGoal.objective,
          targetValue: generated.context.macroGoal.targetValue,
          unit: generated.context.macroGoal.unit,
        }
      : null,
    campaign: generated.context.campaign ?? null,
    runtime: generated.context.runtime ?? null,
    missionSalesBrief: generated.context.missionSalesBrief ?? null,
    verifiedMetricsPresent: Boolean(generated.context.verifiedMetrics),
    needsDetailsActions:
      generated.context.runtime?.workItems.filter(item => item.detailState === "NEEDS_DETAILS") ?? [],
    workday: generated.context.workday ?? null,
    snapshotId: generated.context.strategySnapshotId ?? (await getLatestStrategySnapshot(input.tenantId))?.id ?? null,
    featuredOperation: await getTodayFeaturedOperation(input.tenantId),
  };
}
