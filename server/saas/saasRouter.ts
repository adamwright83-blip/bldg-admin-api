import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  dayforgeTenantAdminProcedure,
  dayforgeTenantMemberProcedure,
  dayforgeTenantOperatorProcedure,
  publicProcedure,
  router,
} from "../_core/trpc";
import {
  createDayforgeBillingPortal,
  createDayforgeSubscriptionCheckout,
} from "./saasBilling";
import {
  acceptTenantInvite,
  activateOnboardingOwner,
  createTenantInvite,
  getTenantBillingSummary,
  getTenantConfiguration,
  listPublicSaasPlans,
  listTenantMembers,
  requireOnboardingSession,
  saveOnboardingConfiguration,
  startSaasOnboarding,
} from "./saasStore";
import { runTenantImport } from "./tenantImportService";

const locationSchema = z.object({
  label: z.string().trim().min(1).max(128),
  address: z.string().trim().min(5).max(512),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  serviceRadiusMiles: z.number().positive().max(100),
  maxPoundsPerDay: z.number().int().positive().max(1_000_000),
  maxPoundsByWeekday: z.record(z.string(), z.number().int().nonnegative()),
  openCapacityPoundsPerWeek: z.number().int().nonnegative().max(10_000_000),
  pickupDays: z.array(z.string().trim().min(2).max(32)).max(14),
  routeWindows: z.array(z.string().trim().min(2).max(128)).max(40),
  turnaroundHours: z.number().int().positive().max(720),
  deliveryEnabled: z.boolean(),
});

const serviceSchema = z.object({
  locationKey: z.string().trim().min(1).max(128).nullable(),
  serviceKey: z.string().trim().min(1).max(96),
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean(),
  commercialEnabled: z.boolean(),
  pricePerPoundCents: z.number().int().positive().max(100_000).nullable(),
  minimumOrderCents: z.number().int().nonnegative().max(100_000_000).nullable(),
  terms: z.string().trim().max(10_000).nullable(),
});

const configurationSchema = z.object({
  businessName: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(3).max(64),
  contactName: z.string().trim().min(1).max(255),
  contactEmail: z.string().trim().email().max(320),
  contactPhone: z.string().trim().min(7).max(64).nullable(),
  website: z.string().trim().url().max(512).nullable(),
  timeZone: z.string().trim().min(1).max(64),
  brandName: z.string().trim().min(1).max(255),
  logoUrl: z.string().trim().url().max(1024).nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  proposalTemplateKey: z.string().trim().min(1).max(128).nullable(),
  locations: z.array(locationSchema).min(1).max(50),
  services: z.array(serviceSchema).min(1).max(250),
  importProviderKey: z.string().trim().min(1).max(96).nullable(),
});

function publicOnboarding(
  session: Awaited<ReturnType<typeof requireOnboardingSession>>
) {
  return {
    id: session.id,
    businessName: session.businessName,
    slug: session.slug,
    ownerEmail: session.ownerEmail,
    currentStep: session.currentStep,
    version: session.version,
    configuration: session.configurationJson,
    status: session.status,
    tenantId: session.tenantId,
    planKey: session.planKey,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function publicError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const safeMessage =
    /^(A valid|Onboarding|Store,|The selected|Checkout|Complete and|Tenant is|Invite is|This retry|Stripe did not)/.test(
      message
    )
      ? message
      : "The DayForge request could not be completed.";
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: safeMessage,
  });
}

export const saasRouter = router({
  providerStatus: dayforgeTenantMemberProcedure.query(() => ({
    territory: {
      provider: "google_places",
      status: process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY ? "configured" as const : "not_configured" as const,
    },
    billing: {
      provider: "stripe",
      status: process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY ? "configured" as const : "not_configured" as const,
      mode: process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" as const : process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY ? "test" as const : "none" as const,
    },
    sms: {
      provider: "twilio",
      status: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER) ? "configured" as const : "not_configured" as const,
    },
    email: {
      provider: "agentmail",
      status: process.env.AGENTMAIL_API_KEY || process.env.AGENTMAIL_VENDOR_INBOX_ID ? "configured" as const : "not_configured" as const,
    },
    printFulfillment: { provider: "manual", status: "manual_fulfillment" as const, connected: false },
    imports: { provider: "cleancloud_csv", status: "file_import_available" as const, connected: false },
  })),
  plans: publicProcedure.query(() => listPublicSaasPlans()),

  start: publicProcedure
    .input(
      z.object({
        businessName: z.string().trim().min(1).max(255),
        slug: z.string().trim().min(3).max(64),
        ownerEmail: z.string().trim().email().max(320),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await startSaasOnboarding(input);
        return {
          onboarding: result.session ? publicOnboarding(result.session) : null,
          resumeToken: result.resumeToken,
        };
      } catch (error) {
        publicError(error);
      }
    }),

  resume: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        resumeToken: z.string().min(32).max(128),
      })
    )
    .query(async ({ input }) => {
      try {
        return publicOnboarding(await requireOnboardingSession(input));
      } catch (error) {
        publicError(error);
      }
    }),

  saveConfiguration: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        resumeToken: z.string().min(32).max(128),
        expectedVersion: z.number().int().positive(),
        currentStep: z.string().trim().min(1).max(64),
        configuration: configurationSchema,
      })
    )
    .mutation(async ({ input }) => {
      try {
        return publicOnboarding(await saveOnboardingConfiguration(input));
      } catch (error) {
        publicError(error);
      }
    }),

  checkout: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        resumeToken: z.string().min(32).max(128),
        planKey: z.string().trim().min(1).max(96),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await createDayforgeSubscriptionCheckout(input);
      } catch (error) {
        publicError(error);
      }
    }),

  activateOwner: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        resumeToken: z.string().min(32).max(128),
        name: z.string().trim().min(1).max(255),
        password: z.string().min(12).max(128),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const passwordHash = await bcrypt.hash(input.password, 12);
        return await activateOnboardingOwner({ ...input, passwordHash });
      } catch (error) {
        publicError(error);
      }
    }),

  acceptInvite: publicProcedure
    .input(
      z.object({
        token: z.string().min(32).max(128),
        name: z.string().trim().min(1).max(255),
        password: z.string().min(12).max(128),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await acceptTenantInvite({
          ...input,
          passwordHash: await bcrypt.hash(input.password, 12),
        });
      } catch (error) {
        publicError(error);
      }
    }),

  me: dayforgeTenantMemberProcedure.query(async ({ ctx }) => ({
    tenantId: ctx.tenantId,
    membership: ctx.dayforgeMembership,
    configuration: await getTenantConfiguration(ctx.tenantId),
    billing: await getTenantBillingSummary(ctx.tenantId),
  })),

  members: dayforgeTenantAdminProcedure.query(({ ctx }) =>
    listTenantMembers(ctx.tenantId)
  ),

  invite: dayforgeTenantAdminProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(320),
        role: z.enum(["admin", "operator", "field"]),
      })
    )
    .mutation(({ ctx, input }) =>
      createTenantInvite({
        tenantId: ctx.tenantId,
        actorOpenId: ctx.user.openId,
        ...input,
      })
    ),

  billingPortal: dayforgeTenantAdminProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createDayforgeBillingPortal({ tenantId: ctx.tenantId, ...input })
    ),

  importCsv: dayforgeTenantOperatorProcedure
    .input(
      z.object({
        providerKey: z.literal("cleancloud_csv"),
        sourceFileName: z.string().trim().min(1).max(255),
        payload: z.string().min(1).max(5_000_000),
        reportType: z.enum(["orders_sales", "orders_revenue"]),
      })
    )
    .mutation(({ ctx, input }) =>
      runTenantImport({
        tenantId: ctx.tenantId,
        providerKey: input.providerKey,
        sourceFileName: input.sourceFileName,
        payload: input.payload,
        options: { reportType: input.reportType },
      })
    ),
});
