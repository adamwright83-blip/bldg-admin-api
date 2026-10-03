/**
 * Sovereign Franchise Engine Router
 *
 * tRPC endpoints for inspecting active operator franchises,
 * launching new metro territories, and streaming provisioning telemetry.
 *
 * All endpoints are strictly authenticated and protected behind adminProcedure.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  listFranchises,
  getFranchiseById,
  provisionFranchise,
} from "./franchiseService";

export const franchiseRouter = router({
  resolveTenant: adminProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const callerTenantId = ctx.tenantId || "default";
      const target = input?.targetTenantId;
      if (!target || target === "default" || target === callerTenantId) {
        return {
          resolvedTenantId: callerTenantId,
          isCrossTenant: false,
          authorized: true,
        };
      }

      const franchise = await getFranchiseById(target);
      if (!franchise) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Requested tenant "${target}" does not exist.`,
        });
      }

      return {
        resolvedTenantId: franchise.tenantId,
        isCrossTenant: true,
        authorized: true,
        city: franchise.city,
      };
    }),

  list: adminProcedure.query(async () => {
    return listFranchises();
  }),

  getById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const franchise = await getFranchiseById(input.id);
      return franchise;
    }),

  provision: adminProcedure
    .input(
      z.object({
        city: z.string().trim().min(2).max(64),
        state: z.string().trim().min(2).max(16),
        vertical: z.enum([
          "commercial_laundry",
          "highrise_amenity",
          "commercial_textiles",
        ]),
        targetMrrCents: z.number().int().min(100000).max(50000000), // $1k - $500k
        targetAccounts: z.number().int().min(5).max(500).optional(),
        operatorName: z.string().trim().min(2).max(128).optional(),
        operatorPhone: z.string().trim().min(5).max(32).optional(),
        voicePersona: z.string().trim().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return provisionFranchise({
        city: input.city,
        state: input.state,
        vertical: input.vertical,
        targetMrrCents: input.targetMrrCents,
        targetAccounts: input.targetAccounts,
        operatorName: input.operatorName,
        operatorPhone: input.operatorPhone,
        operatorUserId: ctx.user.openId,
        voicePersona: input.voicePersona,
      });
    }),
});
