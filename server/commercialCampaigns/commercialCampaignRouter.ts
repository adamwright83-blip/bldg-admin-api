import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { commercialCampaignLinks, commercialOrderAcquisitionAttributions } from "../../drizzle/schema";
import { dayforgeMissionOperatorProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { createCommercialCampaignLinkService } from "./commercialCampaignLinkService";
import { commercialCampaignLinkRepository } from "./commercialCampaignLinkStore";

function service() {
  return createCommercialCampaignLinkService({ repository: commercialCampaignLinkRepository });
}

export const commercialCampaignRouter = router({
  create: dayforgeMissionOperatorProcedure.input(z.object({
    accountId: z.number().int().positive(), missionId: z.number().int().positive(), pipelineId: z.number().int().positive().nullable().optional(),
    campaignName: z.string().trim().min(1).max(191), placement: z.string().trim().min(1).max(128), collateralVersion: z.string().trim().min(1).max(128),
    salespersonId: z.string().trim().min(1).max(128), referringContactId: z.number().int().positive().nullable().optional(),
    buildingSlug: z.string().trim().max(100).nullable().optional(), offerKey: z.string().trim().max(128).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(), requestId: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    const result = await service().create({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId });
    const origin = (process.env.PUBLIC_APP_ORIGIN ?? "https://app.bldg.chat").replace(/\/$/, "");
    return { ...result, publicUrl: `${origin}/?dfCampaign=${encodeURIComponent(result.token)}` };
  }),
  list: dayforgeMissionOperatorProcedure.input(z.object({ missionId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await getDb(); if (!db) throw new Error("Database not available");
    return db.select({
      id: commercialCampaignLinks.id, campaignName: commercialCampaignLinks.campaignName,
      placement: commercialCampaignLinks.placement, collateralVersion: commercialCampaignLinks.collateralVersion,
      status: commercialCampaignLinks.status, expiresAt: commercialCampaignLinks.expiresAt,
      createdAt: commercialCampaignLinks.createdAt,
      orderCount: sql<number>`COUNT(${commercialOrderAcquisitionAttributions.id})`,
    }).from(commercialCampaignLinks).leftJoin(commercialOrderAcquisitionAttributions, and(
      eq(commercialOrderAcquisitionAttributions.tenantId, ctx.tenantId),
      eq(commercialOrderAcquisitionAttributions.orderCampaignLinkId, commercialCampaignLinks.id)
    )).where(and(eq(commercialCampaignLinks.tenantId, ctx.tenantId), eq(commercialCampaignLinks.missionId, input.missionId)))
      .groupBy(commercialCampaignLinks.id).orderBy(desc(commercialCampaignLinks.createdAt));
  }),
  revoke: dayforgeMissionOperatorProcedure.input(z.object({ linkId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const db = await getDb(); if (!db) throw new Error("Database not available");
    await db.update(commercialCampaignLinks).set({ status: "revoked", revokedAt: new Date() }).where(and(
      eq(commercialCampaignLinks.tenantId, ctx.tenantId), eq(commercialCampaignLinks.id, input.linkId)
    ));
    return { revoked: true };
  }),
  validate: publicProcedure.input(z.object({ tenantId: z.string().trim().min(1).max(64), token: z.string().min(20).max(512) })).query(({ input }) => service().validate(input)),
});
