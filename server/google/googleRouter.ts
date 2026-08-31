import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { googleWorldService } from "./googleWorldService";

export const googleRouter = router({
  capabilities: adminProcedure.query(async () => {
    const [capabilities, runtimeConfig] = await Promise.all([
      googleWorldService.getCapabilities(),
      Promise.resolve(googleWorldService.getPublicRuntimeConfig()),
    ]);
    return { capabilities, runtimeConfig };
  }),

  runtimeConfig: publicProcedure.query(() => {
    return googleWorldService.getPublicRuntimeConfig();
  }),

  atmosphere: publicProcedure
    .input(z.object({ forceFresh: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      return googleWorldService.getAtmosphere(input?.forceFresh);
    }),

  opportunityPressure: adminProcedure
    .input(z.object({ forceFresh: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      return googleWorldService.getOpportunityPressure(input?.forceFresh);
    }),

  buildingReality: adminProcedure
    .input(z.object({ buildingId: z.string().min(1) }))
    .query(async ({ input }) => {
      return googleWorldService.getPlaceReality(input.buildingId);
    }),

  validateAndGeocode: adminProcedure
    .input(z.object({ address: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return googleWorldService.validateAndGeocodeAddress(input.address);
    }),

  telemetry: adminProcedure.query(() => {
    return googleWorldService.getTelemetry();
  }),
});
