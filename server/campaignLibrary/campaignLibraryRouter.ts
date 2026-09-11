import { z } from "zod";
import { adminProcedure, dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getCampaign,
  listCampaigns,
  patchCampaign,
  seedCampaignsIfMissing,
  setCampaignEnabled,
  upsertCampaign,
} from "./campaignLibraryService";
import { SEED_CAMPAIGNS } from "./seedCampaigns";
import { MISSION_CATEGORIES, POCKET_KINDS } from "./campaignLibraryTypes";

const fallbackVariant = z
  .object({
    title: z.string().min(1).max(191),
    completionCondition: z.string().min(1).max(512),
    pocketMinutesMin: z.number().int().positive(),
  })
  .nullable();

const timingAssumption = z.object({
  assumption: z.string().min(1).max(512),
  source: z.string().min(1).max(255),
  recordedAt: z.string(),
});

const campaignInput = z.object({
  enabled: z.boolean(),
  title: z.string().min(1).max(191),
  objective: z.string().min(1).max(512),
  completionCondition: z.string().min(1).max(512),
  prepLeadDays: z.number().int().min(0),
  prepCondition: z.string().max(512).nullable(),
  pocketKind: z.enum(POCKET_KINDS),
  pocketMinutesMin: z.number().int().positive(),
  fallbackVariant,
  autoVerifiable: z.array(z.string().max(255)),
  selfReported: z.array(z.string().max(255)),
  missionCategory: z.enum(MISSION_CATEGORIES),
  companionAbilityId: z.string().max(64).nullable(),
  timingAssumptions: z.array(timingAssumption),
  opsTaskType: z.string().min(1).max(64),
  legacyContract: z.enum(["lead_hunt"]).nullable(),
  legacyContractRef: z.object({ leadHuntId: z.string() }).nullable(),
});

const campaignPatch = campaignInput.partial();

export const campaignLibraryRouter = router({
  list: dayforgeTenantMemberProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }))
    .query(({ ctx, input }) =>
      listCampaigns({ tenantId: ctx.tenantId, ...input })
    ),
  get: dayforgeTenantMemberProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(({ ctx, input }) => getCampaign({ tenantId: ctx.tenantId, ...input })),
  upsert: adminProcedure
    .input(z.object({ campaignId: z.string(), campaign: campaignInput }))
    .mutation(({ ctx, input }) =>
      upsertCampaign({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  patch: adminProcedure
    .input(z.object({ campaignId: z.string(), patch: campaignPatch }))
    .mutation(({ ctx, input }) =>
      patchCampaign({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setEnabled: adminProcedure
    .input(z.object({ campaignId: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setCampaignEnabled({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  seedDefaults: adminProcedure
    .input(z.object({}).optional())
    .mutation(({ ctx }) =>
      seedCampaignsIfMissing({
        tenantId: ctx.tenantId ?? "default",
        campaigns: SEED_CAMPAIGNS,
      })
    ),
});
