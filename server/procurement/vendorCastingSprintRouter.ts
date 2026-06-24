import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listRequestJobCardSourceRecords } from "../db";
import { buildCastingSprintBootstrapHandoff, type CastingSprintBootstrapHandoff } from "./castingSprintBootstrapBridgePolicy";
import { buildRequestJobCardPage, REQUEST_JOB_CARD_SOURCE_TYPES, type RequestJobCardSourceType } from "./requestJobCardReadModel";
import { buildCastingMission, type CastingMission } from "./vendorCastingSprintPolicy";

const SOURCE_KEY_PATTERN = /^(service_request|resident_coordinated_request|resident_agent_plan):(.+)$/;

function parseSourceKey(sourceKey: string): { sourceType: RequestJobCardSourceType; sourceId: string } | null {
  const match = SOURCE_KEY_PATTERN.exec(sourceKey.trim());
  if (!match) return null;
  const sourceType = match[1] as RequestJobCardSourceType;
  if (!REQUEST_JOB_CARD_SOURCE_TYPES.includes(sourceType)) return null;
  return { sourceType, sourceId: match[2] };
}

export type CastingMissionResult = {
  found: boolean;
  blockedReasons: string[];
  mission: CastingMission | null;
};

async function resolveMission(input: { tenantId: string; sourceKey: string }): Promise<CastingMissionResult> {
  const parsed = parseSourceKey(input.sourceKey);
  if (!parsed) {
    return { found: false, blockedReasons: ["source_key_format_invalid"], mission: null };
  }
  const sources = await listRequestJobCardSourceRecords({
    tenantId: input.tenantId,
    sources: [parsed.sourceType],
    fetchCount: 1051,
  });
  const page = buildRequestJobCardPage({ sources, limit: 1051, offset: 0 });
  const sourceItem = page.items.find(item => `${item.sourceRecordType}:${item.sourceRecordId}` === input.sourceKey.trim());
  if (!sourceItem) {
    return { found: false, blockedReasons: ["source_job_card_not_found"], mission: null };
  }
  const jobCard = sourceItem.jobCards.find(card => card.status === "job_card_ready_for_admin_review") ?? sourceItem.jobCards[0];
  if (!jobCard) {
    return { found: false, blockedReasons: ["no_job_card_derivable_from_source"], mission: null };
  }
  if (jobCard.status !== "job_card_ready_for_admin_review") {
    return { found: true, blockedReasons: [`job_card_status_${jobCard.status}`], mission: null };
  }
  const mission = buildCastingMission({ jobCard, sourceKey: input.sourceKey.trim() });
  return { found: true, blockedReasons: [], mission };
}

export type CastingSprintBootstrapHandoffResponse = {
  found: boolean;
  allowed: boolean;
  blockedReasons: string[];
  handoff: CastingSprintBootstrapHandoff | null;
};

export const vendorCastingSprintRouter = router({
  mission: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191) }))
    .query(async ({ ctx, input }): Promise<CastingMissionResult> => resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey })),

  bootstrapHandoff: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191), leadId: z.string().min(1).max(191).optional() }))
    .query(async ({ ctx, input }): Promise<CastingSprintBootstrapHandoffResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission) {
        return { found: result.found, allowed: false, blockedReasons: result.blockedReasons, handoff: null };
      }
      const handoffResult = buildCastingSprintBootstrapHandoff({ mission: result.mission, leadId: input.leadId });
      if (!handoffResult.allowed) {
        return { found: true, allowed: false, blockedReasons: handoffResult.reasons, handoff: null };
      }
      return { found: true, allowed: true, blockedReasons: [], handoff: handoffResult.handoff };
    }),
});
