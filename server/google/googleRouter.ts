import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { googleWorldService } from "./googleWorldService";

export const googleRouter = router({
  capabilities: adminProcedure.query(async () => {
    const [capabilities, runtimeConfig] = await Promise.all([
      googleWorldService.getCapabilities(),
      Promise.resolve(googleWorldService.getPublicRuntimeConfig()),
    ]);
    return { capabilities, runtimeConfig };
  }),

  /**
   * Admin-only, despite returning a browser-intended key.
   *
   * The Maps JavaScript key must reach the browser to be usable, so it is not
   * a server secret. But serving it from an ANONYMOUS endpoint means it can be
   * harvested without ever loading the admin app, and every consumer of this
   * procedure (WorldGeographySurface, WorldTransitionProvider) already renders
   * behind admin auth — so `publicProcedure` bought nothing and cost key
   * hygiene. Referrer restrictions in Google Cloud remain the real control;
   * this removes the free scraping surface in front of them.
   */
  runtimeConfig: adminProcedure.query(() => {
    return googleWorldService.getPublicRuntimeConfig();
  }),

  /**
   * Admin-only for billing integrity: this proxies live Google Weather and Air
   * Quality calls, so an anonymous caller could drive metered provider spend
   * simply by polling it. Its only consumers are admin surfaces.
   */
  atmosphere: adminProcedure
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
