import { describe, expect, it, vi } from "vitest";
import {
  parseServicesFromText,
  runVendorOnboardingTurn,
  type VendorOnboardingAgentDeps,
  type VendorOnboardingPlan,
} from "./vendorOnboardingAgent";

function baseSession(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    tenantId: "default",
    vendorId: 7,
    sessionId: "von_agenttest123",
    conversationId: "conv_agent",
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

function makeDeps(options: {
  session?: any;
  services?: any[];
  availability?: any[];
  invokePlan?: VendorOnboardingAgentDeps["invokePlan"];
} = {}) {
  let session = options.session ?? baseSession();
  const messages: any[] = [];
  const services = [...(options.services ?? [])];
  const availability = [...(options.availability ?? [])];
  const toolEvents: any[] = [];
  const deps: VendorOnboardingAgentDeps = {
    getSessionByToken: vi.fn().mockImplementation(async () => session),
    getVendorById: vi.fn().mockResolvedValue({ id: 7, name: "Luxe Hair", slug: "luxehair" } as any),
    getVendorProfileByVendorId: vi.fn().mockResolvedValue({ id: 1, tenantId: "default", vendorId: 7, businessName: "Luxe Hair", vendorCategory: "hair stylist" } as any),
    getVendorAdminConfig: vi.fn().mockResolvedValue({ id: 1, tenantId: "default", vendorId: 7, categoryPresetKey: "beauty_mobile", publicBookingSlug: "luxehair" } as any),
    listServices: vi.fn().mockImplementation(async () => services),
    listAvailability: vi.fn().mockImplementation(async () => availability),
    listMessages: vi.fn().mockImplementation(async () => messages),
    createMessage: vi.fn().mockImplementation(async (message: any) => {
      messages.push({ id: messages.length + 1, createdAt: new Date(), ...message });
      return messages.length;
    }),
    updateSession: vi.fn().mockImplementation(async (_tenantId: string, _id: number, patch: any) => {
      session = { ...session, ...patch };
    }),
    runTool: vi.fn().mockImplementation(async (toolName: string, input: any) => {
      toolEvents.push({ toolName, input });
      if (toolName === "prefillVendorFromWebTool") {
        return { sourceUrl: input.sourceUrl, services: [] };
      }
      if (toolName === "createVendorServiceCatalogTool") {
        for (const service of input.services ?? []) {
          services.push({
            id: services.length + 1,
            tenantId: "default",
            vendorId: input.vendorId,
            serviceCategory: input.categoryPresetKey ?? "beauty_mobile",
            description: null,
            recommendedPriceCents: null,
            isMobile: true,
            isBuildingNative: true,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...service,
          });
        }
        return { vendorId: input.vendorId, serviceIds: services.map((service) => service.id), servicesCreated: input.services?.length ?? 0 };
      }
      if (toolName === "setVendorAvailabilityTool") {
        for (const window of input.windows ?? []) {
          availability.push({ id: availability.length + 1, tenantId: "default", vendorId: input.vendorId, ...window });
        }
        return { vendorId: input.vendorId, availabilityWindowIds: availability.map((window) => window.id) };
      }
      if (toolName === "configureVendorBookingRulesTool") {
        return { vendorId: input.vendorId, bookingConfirmationMode: input.bookingConfirmationMode ?? "hybrid" };
      }
      return {};
    }),
    invokePlan: options.invokePlan ?? vi.fn().mockRejectedValue(new Error("ANTHROPIC_API_KEY is not configured")),
  };
  return { deps, messages, services, availability, toolEvents, get session() { return session; } };
}

async function run(message: string, deps: VendorOnboardingAgentDeps) {
  return runVendorOnboardingTurn({ tenantId: "default", sessionToken: "von_agenttest123", message, actorIp: "127.0.0.1" }, deps);
}

describe("vendorOnboardingAgent", () => {
  it("parses hair services into structured rows", () => {
    const services = parseServicesFromText("Haircuts $100, 60 min. Blowouts $75, 45 min. Balayage starts at $250, 2.5 hours.");
    expect(services).toMatchObject([
      { serviceName: "Haircut", basePriceCents: 10000, durationMinutes: 60 },
      { serviceName: "Blowout", basePriceCents: 7500, durationMinutes: 45 },
      { serviceName: "Balayage", basePriceCents: 25000, durationMinutes: 150, priceQualifier: "starts_at" },
    ]);
  });

  it("parses laundry and garment services into multiple rows", () => {
    const services = parseServicesFromText("Wash fold dry is $2.50/lb. Rugs small $15, large $20, sleeping bag $24. Same-day delivery available.");
    expect(services).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceName: "Wash & Fold", basePriceCents: 250, pricingUnit: "pound" }),
      expect.objectContaining({ serviceName: "Rug Small", basePriceCents: 1500 }),
      expect.objectContaining({ serviceName: "Rug Large", basePriceCents: 2000 }),
      expect.objectContaining({ serviceName: "Sleeping Bag", basePriceCents: 2400 }),
      expect.objectContaining({ serviceName: "Same-Day Delivery", needsPriceClarification: true }),
    ]));
  });

  it("asks for a link when publicSourceUrl is missing", async () => {
    const { deps } = makeDeps({ session: baseSession({ publicSourceUrl: null }) });
    const result = await run("hello", deps);
    expect(result.assistantMessage).toBe("Send your website, Instagram, or current booking page.");
    expect(result.fallbackUsed).toBe(true);
  });

  it("vendor says yes with publicSourceUrl and prefill tool is called", async () => {
    const { deps, toolEvents } = makeDeps();
    const result = await run("Yes, use my website.", deps);
    expect(toolEvents).toEqual([expect.objectContaining({
      toolName: "prefillVendorFromWebTool",
      input: { sourceUrl: "https://luxehair.example" },
    })]);
    expect(result.state.lastCompletedStep).toBe("website_confirmed");
  });

  it("services text creates vendor_services rows and advances to availability", async () => {
    const { deps, services } = makeDeps({ session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }) });
    const result = await run("Haircuts $100, 60 min. Blowouts $75, 45 min. Balayage starts at $250, 2.5 hours.", deps);
    expect(services).toHaveLength(3);
    expect(result.state.status).toBe("availability_setup");
    expect(result.state.lastCompletedStep).toBe("services_configured");
    expect(result.assistantMessage).toContain("Next, when should BLDG.chat offer these services?");
  });

  it("does not repeat services question when vendor_services already exist", async () => {
    const { deps } = makeDeps({
      session: baseSession({ status: "availability_setup", lastCompletedStep: "services_configured" }),
      services: [{ id: 1, tenantId: "default", vendorId: 7, serviceName: "Haircut", basePriceCents: 10000, durationMinutes: 60 }],
    });
    const result = await run("What next?", deps);
    expect(result.assistantMessage).toContain("already saved");
    expect(result.assistantMessage).toContain("when should BLDG.chat offer");
  });

  it("availability text creates windows and asks booking rules", async () => {
    const { deps, availability } = makeDeps({
      session: baseSession({ status: "availability_setup", lastCompletedStep: "services_configured" }),
      services: [{ id: 1, tenantId: "default", vendorId: 7, serviceName: "Haircut", basePriceCents: 10000, durationMinutes: 60 }],
    });
    const result = await run("Tuesdays and Thursdays 2-6 PM in Century City.", deps);
    expect(availability).toHaveLength(2);
    expect(result.state.lastCompletedStep).toBe("availability_configured");
    expect(result.assistantMessage).toContain("auto-confirm");
  });

  it("booking rules text updates rules and reaches admin_configured", async () => {
    const { deps, toolEvents } = makeDeps({
      session: baseSession({ status: "pricing_setup", lastCompletedStep: "availability_configured" }),
      services: [{ id: 1, tenantId: "default", vendorId: 7, serviceName: "Haircut", basePriceCents: 10000, durationMinutes: 60 }],
      availability: [{ id: 1, tenantId: "default", vendorId: 7, dayOfWeek: 2, startTime: "14:00", endTime: "18:00" }],
    });
    const result = await run("Use hybrid confirmation, require card on file, 24 hour cancellation window.", deps);
    expect(toolEvents).toEqual([expect.objectContaining({ toolName: "configureVendorBookingRulesTool" })]);
    expect(result.state.status).toBe("admin_configured");
    expect(result.state.lastCompletedStep).toBe("booking_rules_configured");
  });

  it("invalid LLM plans fall back safely", async () => {
    const { deps } = makeDeps({ invokePlan: vi.fn().mockRejectedValue(new SyntaxError("invalid json")) });
    const result = await run("Haircuts $100, 60 min.", deps);
    expect(result.usedLLM).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.state.lastCompletedStep).toBe("services_configured");
  });

  it("LLM structured plan executes only allowlisted registered tools", async () => {
    const plan: VendorOnboardingPlan = {
      intent: "provide_services",
      confidence: 0.91,
      currentStep: "collecting_details",
      nextStep: "availability_setup",
      assistantMessage: "I added 1 service. Next, when should BLDG.chat offer it?",
      toolCalls: [
        { toolName: "createVendorServiceCatalogTool", input: { services: [{ serviceName: "Consultation", basePriceCents: 5000, durationMinutes: 30 }] }, requiresApproval: false },
        { toolName: "exportVendorDataTool", input: { exportType: "clients" }, requiresApproval: false },
      ],
      statePatch: { status: "availability_setup", lastCompletedStep: "services_configured", missingFields: ["availability", "booking_rules"] },
      parsedFields: { services: [{ serviceName: "Consultation" }] },
      needsHumanClarification: true,
    };
    const { deps, toolEvents } = makeDeps({ invokePlan: vi.fn().mockResolvedValue(plan) });
    const result = await run("Consultation is $50 for 30 min.", deps);
    expect(result.usedLLM).toBe(true);
    expect(toolEvents.map((event) => event.toolName)).toEqual(["createVendorServiceCatalogTool"]);
  });
});
