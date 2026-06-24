import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listRequestJobCardSourceRecords } from "../db";
import { buildCastingSprintBootstrapHandoff, type CastingSprintBootstrapHandoff } from "./castingSprintBootstrapBridgePolicy";
import {
  buildCastingSprintOutreachDraft,
  buildRealCandidateCreationPayload,
  validateRealVendorFacts,
  VENDOR_SOURCE_TYPES,
  type CandidateCreationPayload,
  type OutreachDraft,
} from "./castingSprintExecutionPolicy";
import { buildRequestJobCardPage, REQUEST_JOB_CARD_SOURCE_TYPES, type RequestJobCardSourceType } from "./requestJobCardReadModel";
import type { RequestJobCard } from "./requestJobCardPolicy";
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

type ResolvedMission = CastingMissionResult & { jobCard: RequestJobCard | null };

async function resolveMission(input: { tenantId: string; sourceKey: string }): Promise<ResolvedMission> {
  const parsed = parseSourceKey(input.sourceKey);
  if (!parsed) {
    return { found: false, blockedReasons: ["source_key_format_invalid"], mission: null, jobCard: null };
  }
  const sources = await listRequestJobCardSourceRecords({
    tenantId: input.tenantId,
    sources: [parsed.sourceType],
    fetchCount: 1051,
  });
  const page = buildRequestJobCardPage({ sources, limit: 1051, offset: 0 });
  const sourceItem = page.items.find(item => `${item.sourceRecordType}:${item.sourceRecordId}` === input.sourceKey.trim());
  if (!sourceItem) {
    return { found: false, blockedReasons: ["source_job_card_not_found"], mission: null, jobCard: null };
  }
  const jobCard = sourceItem.jobCards.find(card => card.status === "job_card_ready_for_admin_review") ?? sourceItem.jobCards[0];
  if (!jobCard) {
    return { found: false, blockedReasons: ["no_job_card_derivable_from_source"], mission: null, jobCard: null };
  }
  if (jobCard.status !== "job_card_ready_for_admin_review") {
    return { found: true, blockedReasons: [`job_card_status_${jobCard.status}`], mission: null, jobCard };
  }
  const mission = buildCastingMission({ jobCard, sourceKey: input.sourceKey.trim() });
  return { found: true, blockedReasons: [], mission, jobCard };
}

export type CastingSprintBootstrapHandoffResponse = {
  found: boolean;
  allowed: boolean;
  blockedReasons: string[];
  handoff: CastingSprintBootstrapHandoff | null;
};

const vendorFactsInput = z.object({
  businessName: z.string().max(191).default(""),
  phone: z.string().max(80).nullable().optional(),
  email: z.string().max(191).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  sourceType: z.enum(VENDOR_SOURCE_TYPES),
  sourceReference: z.string().max(500).default(""),
  serviceArea: z.string().max(500).default(""),
  qualificationNotes: z.string().max(2000).default(""),
  googleRating: z.number().min(0).max(5).nullable().optional(),
  googleReviewCount: z.number().int().nonnegative().nullable().optional(),
  yelpRating: z.number().min(0).max(5).nullable().optional(),
  yelpReviewCount: z.number().int().nonnegative().nullable().optional(),
  observedAt: z.string().max(40).nullable().optional(),
  negativeFlags: z.array(z.string().max(200)).nullable().optional(),
  sourceConfidenceNotes: z.string().max(2000).nullable().optional(),
});

export type GenerateOutreachDraftResponse =
  | { allowed: true; blockedReasons: []; draft: OutreachDraft }
  | { allowed: false; blockedReasons: string[]; draft: null };

export type CandidateCreationPayloadResponse =
  | { allowed: true; blockedReasons: []; payload: CandidateCreationPayload }
  | { allowed: false; blockedReasons: string[]; payload: null };

export const vendorCastingSprintRouter = router({
  mission: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191) }))
    .query(async ({ ctx, input }): Promise<CastingMissionResult> => {
      const { found, blockedReasons, mission } = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      return { found, blockedReasons, mission };
    }),

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

  generateOutreachDraft: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191), leadId: z.string().min(1).max(191), vendorFacts: vendorFactsInput }))
    .mutation(async ({ ctx, input }): Promise<GenerateOutreachDraftResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], draft: null };
      }
      const lead = result.mission.lanes.flatMap(lane => lane.leads).find(item => item.id === input.leadId);
      if (!lead) {
        return { allowed: false, blockedReasons: ["lead_not_found_in_mission"], draft: null };
      }
      const validation = validateRealVendorFacts(input.vendorFacts, lead);
      if (!validation.valid) {
        return { allowed: false, blockedReasons: validation.reasons, draft: null };
      }
      const draft = buildCastingSprintOutreachDraft({ jobCard: result.jobCard, lead, vendorFacts: input.vendorFacts });
      if (!draft.safeToCopy) {
        return { allowed: false, blockedReasons: ["draft_failed_truth_lint"], draft: null };
      }
      return { allowed: true, blockedReasons: [], draft };
    }),

  /**
   * Validates and builds a createCandidate-compatible payload only; it never
   * calls createCandidate itself, so this mutation alone never writes to
   * vendor_sourcing_candidates. The actual real-candidate write happens when
   * the admin UI separately calls firstRealProposalBootstrap.createCandidate
   * with this payload, as an explicit, distinct admin action.
   */
  candidateCreationPayload: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191), leadId: z.string().min(1).max(191), vendorFacts: vendorFactsInput }))
    .mutation(async ({ ctx, input }): Promise<CandidateCreationPayloadResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], payload: null };
      }
      const lead = result.mission.lanes.flatMap(lane => lane.leads).find(item => item.id === input.leadId);
      if (!lead) {
        return { allowed: false, blockedReasons: ["lead_not_found_in_mission"], payload: null };
      }
      const decision = buildRealCandidateCreationPayload({ jobCard: result.jobCard, lead, vendorFacts: input.vendorFacts, tenantId: ctx.tenantId });
      if (!decision.allowed) {
        return { allowed: false, blockedReasons: decision.reasons, payload: null };
      }
      return { allowed: true, blockedReasons: [], payload: decision.payload };
    }),
});
