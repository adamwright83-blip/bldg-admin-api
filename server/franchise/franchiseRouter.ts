/**
 * Sovereign Franchise Engine Router
 *
 * tRPC endpoints for inspecting active operator franchises,
 * launching new metro territories, and streaming provisioning telemetry.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  listFranchises,
  getFranchiseById,
  provisionFranchise,
} from "./franchiseService";

export const franchiseRouter = router({
  list: publicProcedure.query(async () => {
    return listFranchises();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const franchise = await getFranchiseById(input.id);
      return franchise;
    }),

  provision: publicProcedure
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
    .mutation(async ({ input }) => {
      return provisionFranchise({
        city: input.city,
        state: input.state,
        vertical: input.vertical,
        targetMrrCents: input.targetMrrCents,
        targetAccounts: input.targetAccounts,
        operatorName: input.operatorName,
        operatorPhone: input.operatorPhone,
        voicePersona: input.voicePersona,
      });
    }),
});
