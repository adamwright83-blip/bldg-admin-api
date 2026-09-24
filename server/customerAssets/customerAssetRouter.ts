/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyLegacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { getCustomerAsset, listCustomerAssets } from "./customerAssetProjection";

export const customerAssetRouter = router({
  list: legacyLegacyDayforgeTenantMemberProcedure.query(({ ctx }) => listCustomerAssets({ tenantId: ctx.tenantId })),
  detail: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ assetId: z.string().min(1).max(191) }))
    .query(async ({ ctx, input }) => {
      const asset = await getCustomerAsset({ tenantId: ctx.tenantId, assetId: input.assetId });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Customer asset not found" });
      return asset;
    }),
});
