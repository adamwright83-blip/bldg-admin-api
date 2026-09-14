import { assembleClaireDriveContext } from "./contextAssembler";
import {
  getClaireGenerationStats,
  type ClaireGenerationDiagnostic,
} from "./generationTelemetry";
import { writeClairePreDriveBrief } from "./reasoning";

export async function generateClairePreDriveOutput(
  input: { tenantId: string; actorId: string; timeZone?: string },
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
  },
  dependencies: Parameters<typeof generateClairePreDriveOutput>[1] = {}
) {
  const generated = await generateClairePreDriveOutput(input, dependencies);
  return {
    brief: generated.brief,
    source: generated.diagnostic.source,
    failureReason: generated.diagnostic.failureReason,
    generatedAt: generated.context.generatedAt,
    businessDate: generated.context.businessDate,
    generationStats: getClaireGenerationStats(input.tenantId),
    writesBusinessTruth: false as const,
  };
}
