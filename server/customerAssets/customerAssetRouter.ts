import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { getCustomerAsset, listCustomerAssets } from "./customerAssetProjection";

export const customerAssetRouter = router({
  list: dayforgeTenantMemberProcedure.query(({ ctx }) => listCustomerAssets({ tenantId: ctx.tenantId })),
  detail: dayforgeTenantMemberProcedure
    .input(z.object({ assetId: z.string().min(1).max(191) }))
    .query(async ({ ctx, input }) => {
      const asset = await getCustomerAsset({ tenantId: ctx.tenantId, assetId: input.assetId });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Customer asset not found" });
      return asset;
    }),
});
