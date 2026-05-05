import type { Request, Response, Router } from "express";
import { z } from "zod";
import {
  createVendorGuestBookingSession,
  getVendorAdminConfig,
  getVendorAdminConfigBySlug,
  getVendorOnboardingSessionByToken,
  getVendorProfileByVendorId,
  listVendorAvailabilityWindows,
  listVendorServices,
  updateVendorAdminConfig,
} from "./db";
import { getVendorCategoryPreset } from "./agents/vendorCategoryPresets";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import type { VendorAdminConfig, VendorAvailabilityWindow, VendorOnboardingSession, VendorProfile, VendorService } from "../drizzle/schema";

export const VENDOR_BOOKING_TEMPLATE_KEY = "vendor_booking_template_01";
export const VENDOR_BOOKING_PUBLIC_BASE_URL = "https://vendorsignup.bldg.chat/book";

type BookingMode = "public" | "preview";

type BookingContext = {
  tenantId: string;
  adminConfig: VendorAdminConfig;
  profile?: VendorProfile;
  services: VendorService[];
  availability: VendorAvailabilityWindow[];
  session?: VendorOnboardingSession;
};

export type VendorBookingDeps = {
  getAdminConfigBySlug: typeof getVendorAdminConfigBySlug;
  getAdminConfig: typeof getVendorAdminConfig;
  getSessionByToken: typeof getVendorOnboardingSessionByToken;
  getProfile: typeof getVendorProfileByVendorId;
  listServices: typeof listVendorServices;
  listAvailability: typeof listVendorAvailabilityWindows;
  updateAdminConfig: typeof updateVendorAdminConfig;
  createGuestBookingSession: typeof createVendorGuestBookingSession;
};

export const defaultVendorBookingDeps: VendorBookingDeps = {
  getAdminConfigBySlug: getVendorAdminConfigBySlug,
  getAdminConfig: getVendorAdminConfig,
  getSessionByToken: getVendorOnboardingSessionByToken,
  getProfile: getVendorProfileByVendorId,
  listServices: listVendorServices,
  listAvailability: listVendorAvailabilityWindows,
  updateAdminConfig: updateVendorAdminConfig,
  createGuestBookingSession: createVendorGuestBookingSession,
};

const slugSchema = z.string().trim().min(3).max(128).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const sessionSchema = z.string().trim().min(8).max(128).regex(/^von_[A-Za-z0-9_-]+$/);

const bookingRequestSchema = z.object({
  slug: slugSchema,
  serviceId: z.coerce.number().int().positive(),
  preferredDate: z.string().trim().min(4).max(32),
  preferredTime: z.string().trim().min(2).max(32),
  clientName: z.string().trim().min(1).max(255),
  clientPhone: z.string().trim().min(4).max(30).optional().nullable(),
  clientEmail: z.string().email().max(320).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const publishSchema = z.object({
  session: sessionSchema,
  approve: z.literal(true),
});

const categoryCopy: Record<string, { heroHeadline: string; heroSubhead: string }> = {
  beauty_mobile: {
    heroHeadline: "Private styling appointments, brought to your building.",
    heroSubhead: "Book cuts, blowouts, color, and event styling through a private BLDG.chat booking experience.",
  },
  route_operator: {
    heroHeadline: "Laundry and garment care, collected and returned.",
    heroSubhead: "Schedule wash, fold, dry cleaning, and garment care through a private BLDG.chat booking experience.",
  },
  auto_detail: {
    heroHeadline: "Vehicle care without leaving the property.",
    heroSubhead: "Book detailing services coordinated around your building, garage, or valet area.",
  },
  pet_care: {
    heroHeadline: "Pet grooming coordinated around your building.",
    heroSubhead: "Book grooming appointments with private building-aware scheduling.",
  },
  wellness_mobile: {
    heroHeadline: "Private wellness sessions, scheduled around your building.",
    heroSubhead: "Book training, bodywork, and wellness appointments with building-aware availability.",
  },
  residence_care: {
    heroHeadline: "Private space care for homes, studios, and workspaces.",
    heroSubhead: "Request recurring or one-time care through the BLDG.chat vendor network.",
  },
  generic_vendor: {
    heroHeadline: "Private services, coordinated through BLDG.chat.",
    heroSubhead: "Book trusted services through a private building-aware booking experience.",
  },
};

function normalizedCategoryKey(config?: VendorAdminConfig, profile?: VendorProfile) {
  const key = config?.categoryPresetKey ?? profile?.vendorCategory ?? "generic_vendor";
  return getVendorCategoryPreset(key).internalCategoryKey;
}

export function buildDefaultTemplateContent(input: {
  adminConfig?: VendorAdminConfig;
  profile?: VendorProfile;
}) {
  const categoryPresetKey = normalizedCategoryKey(input.adminConfig, input.profile);
  const defaults = categoryCopy[categoryPresetKey] ?? categoryCopy.generic_vendor;
  const businessName = input.profile?.businessName
    ?? input.adminConfig?.brandName
    ?? "BLDG.chat Vendor";
  const logoText = (input.adminConfig?.brandName ?? businessName).slice(0, 40);
  return {
    brandName: businessName,
    logoText,
    heroHeadline: defaults.heroHeadline,
    heroSubhead: defaults.heroSubhead,
    primaryCtaText: "Book Appointment",
    secondaryCtaText: "View Services",
    trustLineOne: "Private booking",
    trustLineTwo: "Card-on-file protection",
    serviceSectionTitle: "Services",
    aboutSectionTitle: "About",
    aboutBody: `${businessName} is available through a private BLDG.chat booking experience.`,
    serviceAreaText: input.profile?.serviceAreaJson ? JSON.stringify(input.profile.serviceAreaJson) : "Building-aware service area configured through BLDG.chat.",
    hoursText: "Availability is shown during booking.",
    cancellationText: "Your appointment is not final until confirmed. Cancellation terms may vary by service.",
    footerText: "Powered by BLDG.chat",
  };
}

function templateContentFor(config: VendorAdminConfig, profile?: VendorProfile) {
  const fallback = buildDefaultTemplateContent({ adminConfig: config, profile });
  const stored = config.templateContentJson && typeof config.templateContentJson === "object" && !Array.isArray(config.templateContentJson)
    ? config.templateContentJson as Record<string, unknown>
    : {};
  return { ...fallback, ...stored };
}

function bookingRulesFor(profile?: VendorProfile, config?: VendorAdminConfig) {
  return {
    bookingLeadTimeHours: profile?.bookingLeadTimeHours ?? 24,
    providerResponseTimeoutMinutes: profile?.providerResponseTimeoutMinutes ?? 120,
    bookingConfirmationMode: "hybrid",
    cardOnFileRequired: true,
    publicBookingStatus: config?.publicBookingStatus ?? "draft",
    chargesBeforeApproval: false,
  };
}

function themeFor(config: VendorAdminConfig) {
  return {
    themeKey: config.themeKey,
    brandName: config.brandName ?? null,
    brandLogoUrl: config.brandLogoUrl ?? null,
    brandAccentColor: config.brandAccentColor ?? null,
    enabledSurfaces: config.enabledSurfacesJson ?? [],
  };
}

export function buildVendorBookingPayload(ctx: BookingContext, mode: BookingMode) {
  const categoryPresetKey = normalizedCategoryKey(ctx.adminConfig, ctx.profile);
  return {
    ok: true,
    mode,
    vendor: {
      id: ctx.adminConfig.vendorId,
      businessName: ctx.profile?.businessName ?? ctx.adminConfig.brandName ?? "BLDG.chat Vendor",
      categoryPresetKey,
      publicBookingSlug: ctx.adminConfig.publicBookingSlug,
      publicBookingStatus: ctx.adminConfig.publicBookingStatus ?? "draft",
    },
    template: {
      templateKey: ctx.adminConfig.templateKey ?? VENDOR_BOOKING_TEMPLATE_KEY,
      content: templateContentFor(ctx.adminConfig, ctx.profile),
      theme: themeFor(ctx.adminConfig),
    },
    services: ctx.services.filter((service) => service.isActive).map((service) => ({
      id: service.id,
      serviceName: service.serviceName,
      description: service.description,
      basePriceCents: service.basePriceCents,
      pricingUnit: "flat",
      durationMinutes: service.durationMinutes,
      isActive: service.isActive,
    })),
    availability: ctx.availability.filter((window) => window.isActive),
    bookingRules: bookingRulesFor(ctx.profile, ctx.adminConfig),
  };
}

async function loadByConfig(tenantId: string, adminConfig: VendorAdminConfig, deps: VendorBookingDeps): Promise<BookingContext> {
  const profile = await deps.getProfile(tenantId, adminConfig.vendorId);
  const services = await deps.listServices(tenantId, adminConfig.vendorId);
  const availability = await deps.listAvailability(tenantId, adminConfig.vendorId);
  return { tenantId, adminConfig, profile, services, availability };
}

export function createVendorBookingHandlers(deps = defaultVendorBookingDeps) {
  return {
    getPublic: async (req: Request, res: Response) => {
      const slugValue = req.params.slug ?? req.query.slug;
      const parsed = slugSchema.safeParse(slugValue);
      if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid booking slug", code: "VENDOR_BOOKING_BAD_SLUG" });
      const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
      const config = await deps.getAdminConfigBySlug(tenantId, parsed.data);
      if (!config || config.publicBookingStatus !== "published") {
        return res.status(404).json({ ok: false, error: "Booking page not found", code: "VENDOR_BOOKING_NOT_FOUND" });
      }
      const ctx = await loadByConfig(tenantId, config, deps);
      return res.status(200).json(buildVendorBookingPayload(ctx, "public"));
    },
    getPreview: async (req: Request, res: Response) => {
      const parsed = sessionSchema.safeParse(req.query.session);
      if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid preview session", code: "VENDOR_BOOKING_BAD_SESSION" });
      const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
      const session = await deps.getSessionByToken(tenantId, parsed.data);
      if (!session?.vendorId) return res.status(404).json({ ok: false, error: "Preview not found", code: "VENDOR_BOOKING_PREVIEW_NOT_FOUND" });
      const config = await deps.getAdminConfig(tenantId, session.vendorId);
      if (!config) return res.status(404).json({ ok: false, error: "Draft booking config not found", code: "VENDOR_BOOKING_CONFIG_NOT_FOUND" });
      const ctx = await loadByConfig(tenantId, config, deps);
      ctx.session = session;
      return res.status(200).json(buildVendorBookingPayload(ctx, "preview"));
    },
    publish: async (req: Request, res: Response) => {
      const parsed = publishSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid publish request", code: "VENDOR_BOOKING_BAD_PUBLISH", issues: parsed.error.issues });
      const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
      const session = await deps.getSessionByToken(tenantId, parsed.data.session);
      if (!session?.vendorId) return res.status(404).json({ ok: false, error: "Vendor onboarding session not found", code: "VENDOR_ONBOARDING_SESSION_NOT_FOUND" });
      const [profile, config, services] = await Promise.all([
        deps.getProfile(tenantId, session.vendorId),
        deps.getAdminConfig(tenantId, session.vendorId),
        deps.listServices(tenantId, session.vendorId),
      ]);
      if (!profile) return res.status(409).json({ ok: false, error: "Vendor profile is required before publishing", code: "VENDOR_BOOKING_PROFILE_REQUIRED" });
      if (!config?.publicBookingSlug) return res.status(409).json({ ok: false, error: "Vendor booking config is required before publishing", code: "VENDOR_BOOKING_CONFIG_REQUIRED" });
      if (services.filter((service) => service.isActive).length === 0) {
        return res.status(409).json({ ok: false, error: "At least one active service is required before publishing", code: "VENDOR_BOOKING_SERVICES_REQUIRED" });
      }
      await deps.updateAdminConfig(tenantId, session.vendorId, {
        publicBookingStatus: "published",
        publishedAt: new Date(),
        approvedByUserId: "vendor_onboarding_session",
        templateKey: config.templateKey ?? VENDOR_BOOKING_TEMPLATE_KEY,
        templateContentJson: config.templateContentJson ?? buildDefaultTemplateContent({ adminConfig: config, profile }),
      });
      return res.status(200).json({
        ok: true,
        publicUrl: `${VENDOR_BOOKING_PUBLIC_BASE_URL}/${config.publicBookingSlug}`,
        publicBookingSlug: config.publicBookingSlug,
        publicBookingStatus: "published",
      });
    },
    requestBooking: async (req: Request, res: Response) => {
      const parsed = bookingRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid booking request", code: "VENDOR_BOOKING_BAD_REQUEST", issues: parsed.error.issues });
      const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
      const config = await deps.getAdminConfigBySlug(tenantId, parsed.data.slug);
      if (!config || config.publicBookingStatus !== "published") {
        return res.status(404).json({ ok: false, error: "Booking page not found", code: "VENDOR_BOOKING_NOT_FOUND" });
      }
      const services = await deps.listServices(tenantId, config.vendorId);
      const service = services.find((item) => item.id === parsed.data.serviceId && item.vendorId === config.vendorId && item.isActive);
      if (!service) return res.status(400).json({ ok: false, error: "Service is not available for this vendor", code: "VENDOR_BOOKING_BAD_SERVICE" });
      const requestId = await deps.createGuestBookingSession({
        tenantId,
        vendorId: config.vendorId,
        phone: parsed.data.clientPhone ?? null,
        otpVerified: false,
        trustedDeviceHash: null,
        serviceId: service.id,
        requestedWindowJson: {
          preferredDate: parsed.data.preferredDate,
          preferredTime: parsed.data.preferredTime,
          clientName: parsed.data.clientName,
          clientEmail: parsed.data.clientEmail ?? null,
          notes: parsed.data.notes ?? null,
          source: "vendor_public_booking_page",
          paymentCharged: false,
          externalMessagesSent: false,
        },
        status: "requested",
      });
      return res.status(200).json({
        ok: true,
        requestId,
        status: "requested",
        message: "Your request was received. The vendor will confirm availability.",
      });
    },
  };
}

export function registerVendorBookingPublicRoutes(router: Router, deps = defaultVendorBookingDeps) {
  const handlers = createVendorBookingHandlers(deps);
  router.get("/api/vendor-booking/public/:slug", handlers.getPublic);
  router.get("/api/vendor-booking/preview", handlers.getPreview);
  router.post("/api/vendor-booking/publish", handlers.publish);
  router.post("/api/vendor-booking/request", handlers.requestBooking);
}
