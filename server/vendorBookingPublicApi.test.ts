import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  buildDefaultTemplateContent,
  createVendorBookingHandlers,
  type VendorBookingDeps,
} from "./vendorBookingPublicApi";

function mockResponse() {
  let statusCode = 200;
  let body: any = null;
  const res = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((payload: any) => {
      body = payload;
      return res;
    }),
  } as unknown as Response;
  return { res, get statusCode() { return statusCode; }, get body() { return body; } };
}

function adminConfig(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    tenantId: "default",
    vendorId: 7,
    categoryPresetKey: "beauty_mobile",
    themeKey: "clinical_minimalist",
    enabledSurfacesJson: ["bookings", "services"],
    navConfigJson: null,
    brandConfigJson: null,
    externalBookingBrandMode: "vendor_primary",
    publicBookingSlug: "lumiere-hair-studio",
    templateKey: "vendor_booking_template_01",
    publicBookingStatus: "draft",
    templateContentJson: null,
    publishedAt: null,
    approvedByUserId: null,
    customDomain: null,
    customDomainStatus: "not_configured",
    brandName: "LUMIERE Hair Studio",
    brandLogoUrl: null,
    brandAccentColor: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function profile(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    tenantId: "default",
    vendorId: 7,
    businessName: "LUMIERE Hair Studio",
    vendorCategory: "beauty_mobile",
    serviceAreaJson: null,
    bookingLeadTimeHours: 24,
    providerResponseTimeoutMinutes: 120,
    ...overrides,
  } as any;
}

function service(overrides: Record<string, any> = {}) {
  return {
    id: 123,
    tenantId: "default",
    vendorId: 7,
    serviceName: "Signature Cut",
    serviceCategory: "beauty_mobile",
    description: "Precision cut",
    basePriceCents: 10000,
    recommendedPriceCents: null,
    durationMinutes: 60,
    isMobile: true,
    isBuildingNative: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function deps(overrides: Partial<VendorBookingDeps> & {
  config?: any;
  currentProfile?: any;
  services?: any[];
} = {}) {
  const currentConfig = overrides.config ?? adminConfig();
  const currentProfile = overrides.currentProfile ?? profile();
  const currentServices = overrides.services ?? [service()];
  return {
    getAdminConfigBySlug: vi.fn().mockResolvedValue(currentConfig),
    getAdminConfig: vi.fn().mockResolvedValue(currentConfig),
    getSessionByToken: vi.fn().mockResolvedValue({
      id: 42,
      tenantId: "default",
      vendorId: 7,
      sessionId: "von_bookingtest",
      conversationId: "conv",
    } as any),
    getProfile: vi.fn().mockResolvedValue(currentProfile),
    listServices: vi.fn().mockResolvedValue(currentServices),
    listAvailability: vi.fn().mockResolvedValue([{ id: 1, vendorId: 7, dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isActive: true } as any]),
    updateAdminConfig: vi.fn().mockResolvedValue(undefined),
    createGuestBookingSession: vi.fn().mockResolvedValue(555),
    ...overrides,
  } as unknown as VendorBookingDeps;
}

describe("vendor booking public API", () => {
  it("GET preview by onboarding session returns draft page payload", async () => {
    const testDeps = deps();
    const handlers = createVendorBookingHandlers(testDeps);
    const response = mockResponse();
    await handlers.getPreview({ query: { session: "von_bookingtest" }, headers: {} } as unknown as Request, response.res);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      mode: "preview",
      vendor: {
        businessName: "LUMIERE Hair Studio",
        categoryPresetKey: "beauty_mobile",
        publicBookingSlug: "lumiere-hair-studio",
        publicBookingStatus: "draft",
      },
      template: { templateKey: "vendor_booking_template_01" },
    });
  });

  it("GET public by slug returns 404 when status is draft", async () => {
    const handlers = createVendorBookingHandlers(deps());
    const response = mockResponse();
    await handlers.getPublic({ params: { slug: "lumiere-hair-studio" }, query: {}, headers: {} } as unknown as Request, response.res);
    expect(response.statusCode).toBe(404);
  });

  it("publish endpoint fails if vendor has no services", async () => {
    const testDeps = deps({ services: [] });
    const handlers = createVendorBookingHandlers(testDeps);
    const response = mockResponse();
    await handlers.publish({ body: { session: "von_bookingtest", approve: true }, headers: {} } as unknown as Request, response.res);
    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe("VENDOR_BOOKING_SERVICES_REQUIRED");
  });

  it("publish endpoint succeeds when vendor has profile, services, and admin config", async () => {
    const testDeps = deps();
    const handlers = createVendorBookingHandlers(testDeps);
    const response = mockResponse();
    await handlers.publish({ body: { session: "von_bookingtest", approve: true }, headers: {} } as unknown as Request, response.res);
    expect(response.statusCode).toBe(200);
    expect(testDeps.updateAdminConfig).toHaveBeenCalledWith("default", 7, expect.objectContaining({
      publicBookingStatus: "published",
      templateKey: "vendor_booking_template_01",
    }));
    expect(response.body.publicUrl).toBe("https://vendorsignup.bldg.chat/book/lumiere-hair-studio");
  });

  it("GET public by slug returns payload when published", async () => {
    const handlers = createVendorBookingHandlers(deps({ config: adminConfig({ publicBookingStatus: "published" }) }));
    const response = mockResponse();
    await handlers.getPublic({ params: { slug: "lumiere-hair-studio" }, query: {}, headers: {} } as unknown as Request, response.res);
    expect(response.statusCode).toBe(200);
    expect(response.body.mode).toBe("public");
    expect(response.body.services).toHaveLength(1);
  });

  it("public payload includes fallback template copy", async () => {
    const handlers = createVendorBookingHandlers(deps({ config: adminConfig({ publicBookingStatus: "published", templateContentJson: null }) }));
    const response = mockResponse();
    await handlers.getPublic({ params: { slug: "lumiere-hair-studio" }, query: {}, headers: {} } as unknown as Request, response.res);
    expect(response.body.template.content).toMatchObject({
      primaryCtaText: "Book Appointment",
      footerText: "Powered by BLDG.chat",
    });
  });

  it("category beauty_mobile gets styling copy", () => {
    expect(buildDefaultTemplateContent({ adminConfig: adminConfig(), profile: profile() })).toMatchObject({
      heroHeadline: "Private styling appointments, brought to your building.",
    });
  });

  it("category route_operator gets laundry and garment copy", () => {
    expect(buildDefaultTemplateContent({
      adminConfig: adminConfig({ categoryPresetKey: "route_operator" }),
      profile: profile({ vendorCategory: "route_operator", businessName: "Laundry Farm" }),
    })).toMatchObject({
      heroHeadline: "Laundry and garment care, collected and returned.",
    });
  });

  it("POST booking request creates vendor_guest_booking_sessions row without charging card", async () => {
    const testDeps = deps({ config: adminConfig({ publicBookingStatus: "published" }) });
    const handlers = createVendorBookingHandlers(testDeps);
    const response = mockResponse();
    await handlers.requestBooking({
      body: {
        slug: "lumiere-hair-studio",
        serviceId: 123,
        preferredDate: "2026-05-10",
        preferredTime: "14:00",
        clientName: "Sarah Mitchell",
        clientPhone: "5551234567",
        clientEmail: "sarah@example.com",
        notes: "Building resident, prefers afternoon.",
      },
      headers: {},
    } as unknown as Request, response.res);
    expect(response.statusCode).toBe(200);
    expect(testDeps.createGuestBookingSession).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 7,
      serviceId: 123,
      status: "requested",
      requestedWindowJson: expect.objectContaining({
        paymentCharged: false,
        externalMessagesSent: false,
      }),
    }));
    expect(response.body).toMatchObject({ ok: true, requestId: 555, status: "requested" });
  });
});
