import { CLAIRE_COMPILER_VERSION } from "./character/compiler";
import { CLAIRE_CHARACTER_VERSION } from "./character/characterDefinition";
import { getClaireRelationshipState } from "./character/relationshipState";
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  getClaireGenerationStats,
  type ClaireGenerationDiagnostic,
} from "./generationTelemetry";
import { writeClairePreDriveBrief } from "./reasoning";

export async function generateClairePreDriveOutput(
  input: { tenantId: string; actorId: string; timeZone?: string; missionId?: number },
  dependencies: {
    assemble?: typeof assembleClaireDriveContext;
    writeBrief?: typeof writeClairePreDriveBrief;
  } = {}
) {
  const assemble = dependencies.assemble ?? assembleClaireDriveContext;
  const writeBrief = dependencies.writeBrief ?? writeClairePreDriveBrief;
  const context = await assemble({
    tenantId: input.tenantId,
    actorId: input.actorId,
    phase: "pre_drive",
    timeZone: input.timeZone,
    missionId: input.missionId,
  });
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
  };
}
