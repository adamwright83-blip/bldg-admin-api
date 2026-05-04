import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createVendorOnboardingSessionHandlers, type VendorOnboardingSessionDeps } from "./vendorOnboardingSessionApi";

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

function baseSession(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    tenantId: "default",
    vendorId: 7,
    sessionId: "von_testsession123",
    conversationId: "conv_123",
    publicSourceUrl: "https://luxehair.example",
    vendorCategory: "beauty_mobile",
    status: "started",
    lastCompletedStep: "intent_detected",
    missingFieldsJson: [],
    abandoned2hLoggedAt: null,
    abandoned24hLoggedAt: null,
    abandoned7dLoggedAt: null,
    abandonedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function deps(overrides: Partial<VendorOnboardingSessionDeps> = {}) {
  return {
    getSessionByToken: vi.fn().mockResolvedValue(baseSession()),
    getVendorById: vi.fn().mockResolvedValue({ id: 7, name: "Luxe Hair", slug: "luxehair" } as any),
    getVendorProfileByVendorId: vi.fn().mockResolvedValue({
      id: 1,
      tenantId: "default",
      vendorId: 7,
      businessName: "Luxe Hair",
      vendorCategory: "hair stylist",
    } as any),
    getVendorAdminConfig: vi.fn().mockResolvedValue({
      id: 1,
      tenantId: "default",
      vendorId: 7,
      categoryPresetKey: "beauty_mobile",
      publicBookingSlug: "luxehair",
    } as any),
    listMessages: vi.fn().mockResolvedValue([]),
    createMessage: vi.fn().mockResolvedValue(101),
    updateSession: vi.fn().mockResolvedValue(undefined),
    runTool: vi.fn().mockResolvedValue({ sourceUrl: "https://luxehair.example", services: [] }),
    ...overrides,
  } as unknown as VendorOnboardingSessionDeps;
}

describe("vendor onboarding live session API", () => {
  it("loads current onboarding state by public session token", async () => {
    const testDeps = deps();
    const handlers = createVendorOnboardingSessionHandlers(testDeps);
    const response = mockResponse();

    await handlers.getSession({
      query: { session: "von_testsession123" },
      headers: {},
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as Request, response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      session: {
        sessionToken: "von_testsession123",
        sessionId: "42",
        conversationId: "conv_123",
        status: "started",
        lastCompletedStep: "intent_detected",
        vendorCategory: "hair stylist",
        categoryPresetKey: "beauty_mobile",
        businessName: "Luxe Hair",
        websiteOrInstagram: "https://luxehair.example",
        publicBookingSlug: "luxehair",
        missingFields: [],
      },
    });
    expect(response.body.session.nextQuestion).toContain("use it to prefill");
  });

  it("persists a vendor message, logs the prefill step, and returns the next agent question", async () => {
    const testDeps = deps();
    const handlers = createVendorOnboardingSessionHandlers(testDeps);
    const response = mockResponse();

    await handlers.postMessage({
      body: { session: "von_testsession123", message: "Yes, use my website." },
      headers: {},
      ip: "10.0.0.2",
      socket: { remoteAddress: "10.0.0.2" },
    } as unknown as Request, response.res);

    expect(response.statusCode).toBe(200);
    expect(testDeps.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 42,
      role: "vendor",
      content: "Yes, use my website.",
    }));
    expect(testDeps.updateSession).toHaveBeenCalledWith("default", 42, {
      status: "collecting_details",
      lastCompletedStep: "website_confirmed",
      missingFieldsJson: ["services", "pricing", "durations"],
    });
    expect(testDeps.runTool).toHaveBeenCalledWith(
      "prefillVendorFromWebTool",
      { sourceUrl: "https://luxehair.example" },
      expect.objectContaining({
        tenantId: "default",
        sessionId: "von_testsession123",
        conversationId: "conv_123",
        agentType: "vendor_agent",
        actorType: "ai_agent",
      })
    );
    expect(response.body).toMatchObject({
      ok: true,
      assistantMessage: "I’ll prepare the setup from your link. For now, tell me your core services, prices, and durations.",
      state: {
        status: "collecting_details",
        lastCompletedStep: "website_confirmed",
        nextQuestion: "What are your core services, prices, and durations?",
        missingFields: ["services", "pricing", "durations"],
      },
    });
  });
});
