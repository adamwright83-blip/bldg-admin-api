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
  adminConfig?: any;
  messages?: any[];
  failTools?: Record<string, string>;
  invokePlan?: VendorOnboardingAgentDeps["invokePlan"];
  prefillOutput?: Record<string, any>;
} = {}) {
  let session = options.session ?? baseSession();
  const messages: any[] = [...(options.messages ?? [])];
  const services = [...(options.services ?? [])];
  const availability = [...(options.availability ?? [])];
  const toolEvents: any[] = [];
  const deps: VendorOnboardingAgentDeps = {
    getSessionByToken: vi.fn().mockImplementation(async () => session),
    getVendorById: vi.fn().mockResolvedValue({ id: 7, name: "Luxe Hair", slug: "luxehair" } as any),
    getVendorProfileByVendorId: vi.fn().mockResolvedValue({ id: 1, tenantId: "default", vendorId: 7, businessName: "Luxe Hair", vendorCategory: "hair stylist" } as any),
    getVendorAdminConfig: vi.fn().mockResolvedValue(options.adminConfig === undefined ? { id: 1, tenantId: "default", vendorId: 7, categoryPresetKey: "beauty_mobile", publicBookingSlug: "luxehair" } as any : options.adminConfig),
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
      if (options.failTools?.[toolName]) {
        throw new Error(options.failTools[toolName]);
      }
      if (toolName === "prefillVendorFromWebTool") {
        return options.prefillOutput ?? { ok: false, sourceUrl: input.sourceUrl, extractionStatus: "failed", services: [], pricingItems: [], businessDetails: {}, warnings: ["No visible service pricing was extracted."] };
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
      if (toolName === "configureVendorAdminTool") {
        return { vendorId: input.vendorId, configId: 99, publicBookingUrl: "https://vendorsignup.bldg.chat/book/luxehair", publicBookingPageLive: false };
      }
      if (toolName === "createVendorDirectBookingSessionTool") {
        return { vendorId: input.vendorId, publicBookingSlug: "luxehair", bookingUrl: "https://vendorsignup.bldg.chat/book/luxehair", publicBookingPageLive: false };
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

  it("does not return fake analyzing copy without a completed prefill result", async () => {
    const plan: VendorOnboardingPlan = {
      intent: "approve_prefill",
      confidence: 0.9,
      currentStep: "started",
      nextStep: "collecting_details",
      assistantMessage: "I’m analyzing your website right now. This takes 30–60 seconds.",
      toolCalls: [],
      statePatch: { status: "collecting_details", lastCompletedStep: "website_confirmed", missingFields: ["services"] },
      parsedFields: {},
      needsHumanClarification: true,
    };
    const { deps } = makeDeps({ invokePlan: vi.fn().mockResolvedValue(plan) });
    const result = await run("Yes, use my website.", deps);
    expect(result.assistantMessage).not.toMatch(/analyzing|30–60|30-60/i);
    expect(result.assistantMessage).toContain("Paste your services");
  });

  it("does not return fake created/saved copy without a completed tool result", async () => {
    const plan: VendorOnboardingPlan = {
      intent: "claim_work",
      confidence: 0.9,
      currentStep: "started",
      nextStep: "collecting_details",
      assistantMessage: "I created your booking page and saved your pricing.",
      toolCalls: [],
      statePatch: { status: "collecting_details", lastCompletedStep: "fake_work", missingFields: ["services"] },
      parsedFields: {},
      needsHumanClarification: true,
    };
    const { deps } = makeDeps({ invokePlan: vi.fn().mockResolvedValue(plan) });
    const result = await run("Yes, use my website.", deps);
    expect(result.assistantMessage).not.toMatch(/created|saved|booking page/i);
    expect(result.assistantMessage).toContain("Paste your services");
  });

  it("failed website extraction returns honest failure copy", async () => {
    const { deps } = makeDeps({
      prefillOutput: { ok: false, sourceUrl: "https://laundry.farm/", extractionStatus: "failed", services: [], pricingItems: [], businessDetails: {}, warnings: ["No visible service pricing was extracted."] },
    });
    const result = await run("Yes, use my website.", deps);
    expect(result.assistantMessage).toBe("I couldn’t extract usable pricing from the site. Paste your pricing and I’ll structure it.");
  });

  it("partial website extraction asks for missing pricing", async () => {
    const { deps } = makeDeps({
      prefillOutput: { ok: true, sourceUrl: "https://laundry.farm/", extractionStatus: "partial", services: [], pricingItems: [], businessDetails: { businessName: "Laundry Farm" }, warnings: ["No visible service pricing was extracted."] },
    });
    const result = await run("Yes, use my website.", deps);
    expect(result.assistantMessage).toBe("I found your business details, but pricing was not visible. Paste your services/prices and I’ll structure them.");
  });

  it("successful website extraction reports extracted service count before saving", async () => {
    const { deps } = makeDeps({
      prefillOutput: {
        ok: true,
        sourceUrl: "https://laundry.farm/",
        extractionStatus: "success",
        services: [{ serviceName: "Wash & Fold", basePriceCents: 250, durationMinutes: 15 }],
        pricingItems: [{ serviceName: "Wash & Fold", basePriceCents: 250 }],
        businessDetails: { businessName: "Laundry Farm" },
        warnings: [],
      },
    });
    const result = await run("Yes, use my website.", deps);
    expect(result.assistantMessage).toBe("I extracted 1 service from https://laundry.farm/. Review these before I save them.");
  });

  it("saves previously extracted website services only after vendor confirms", async () => {
    const { deps, services, toolEvents } = makeDeps({
      session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }),
      messages: [{
        id: 1,
        tenantId: "default",
        sessionId: 42,
        role: "agent",
        content: "I extracted 2 services from https://laundry.farm/. Review these before I save them.",
        metadataJson: {
          parsedFields: {
            services: [
              { serviceName: "Wash & Fold", basePriceCents: 250, durationMinutes: 15, pricingUnit: "pound" },
              { serviceName: "Dress Shirt", basePriceCents: 600, durationMinutes: 60 },
            ],
          },
        },
        createdAt: new Date(),
      }],
    });
    const result = await run("Looks good, save them.", deps);
    expect(toolEvents.map((event) => event.toolName)).toContain("createVendorServiceCatalogTool");
    expect(services).toHaveLength(2);
    expect(result.assistantMessage).toContain("I added 2 services");
    expect(result.state.status).toBe("availability_setup");
  });

  it("services text creates vendor_services rows and advances to availability", async () => {
    const { deps, services } = makeDeps({ session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }) });
    const result = await run("Haircuts $100, 60 min. Blowouts $75, 45 min. Balayage starts at $250, 2.5 hours.", deps);
    expect(services).toHaveLength(3);
    expect(result.state.status).toBe("availability_setup");
    expect(result.state.lastCompletedStep).toBe("services_configured");
    expect(result.assistantMessage).toContain("I added 3 services");
    expect(result.assistantMessage).toContain("Next: when should BLDG.chat offer these services?");
  });

  it("large pasted laundry pricing creates vendor_services rows with exact count", async () => {
    const pasted = [
      "Premium Laundry. Unmatched Prices.",
      "Wash & Fold $2.50/lb",
      "Rug Extra Large $35",
      "Rug Large $20",
      "Rug Small $15",
      "Sleeping Bag $24",
      "Dress Shirt $6",
      "Jeans $10",
      "Comforter King $46",
    ].join("\n");
    const { deps, services } = makeDeps({
      session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }),
    });
    const result = await run(pasted, deps);
    expect(services.map((service) => service.serviceName)).toEqual(expect.arrayContaining([
      "Wash & Fold",
      "Rug Extra Large",
      "Rug Large",
      "Rug Small",
      "Sleeping Bag",
      "Dress Shirt",
      "Jeans",
      "Comforter King",
    ]));
    expect(result.assistantMessage).toContain(`I added ${services.length} services`);
    expect(result.state.status).toBe("availability_setup");
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

  it("LLM service plans ensure draft admin and direct booking config when missing", async () => {
    const plan: VendorOnboardingPlan = {
      intent: "provide_services",
      confidence: 0.91,
      currentStep: "collecting_details",
      nextStep: "availability_setup",
      assistantMessage: "I created a live booking page.",
      toolCalls: [
        { toolName: "createVendorServiceCatalogTool", input: { services: [{ serviceName: "Dress Shirt", basePriceCents: 600, durationMinutes: 60 }] }, requiresApproval: false },
      ],
      statePatch: { status: "availability_setup", lastCompletedStep: "services_configured", missingFields: ["availability", "booking_rules"] },
      parsedFields: { services: [{ serviceName: "Dress Shirt" }] },
      needsHumanClarification: true,
    };
    const { deps, toolEvents } = makeDeps({ adminConfig: null, invokePlan: vi.fn().mockResolvedValue(plan) });
    const result = await run("Dress Shirt $6", deps);
    expect(toolEvents.map((event) => event.toolName)).toEqual([
      "createVendorServiceCatalogTool",
      "configureVendorAdminTool",
      "createVendorDirectBookingSessionTool",
    ]);
    expect(result.assistantMessage).toContain("public booking page is not live until you approve and publish it");
    expect(result.assistantMessage).not.toContain("live booking page");
  });

  it("does not claim a booking page is live after draft admin setup", async () => {
    const { deps } = makeDeps({
      session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }),
      adminConfig: null,
    });
    const result = await run("Dress Shirt $6\nJeans $10", deps);
    expect(result.assistantMessage).toContain("public booking page is not live until you approve and publish it");
    expect(result.assistantMessage).not.toMatch(/\blive booking page\b|users can open/i);
  });

  it("runs every mutation through the agent runtime dependency for agent_events", async () => {
    const { deps, toolEvents } = makeDeps({
      session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed" }),
    });
    await run("Dress Shirt $6\nJeans $10", deps);
    expect(toolEvents.map((event) => event.toolName)).toEqual(expect.arrayContaining([
      "createVendorServiceCatalogTool",
    ]));
    expect(deps.runTool).toHaveBeenCalled();
  });

  it("does not advance state when service catalog write fails", async () => {
    const { deps } = makeDeps({
      session: baseSession({ status: "collecting_details", lastCompletedStep: "website_confirmed", missingFieldsJson: ["services"] }),
      failTools: { createVendorServiceCatalogTool: "database unavailable" },
    });
    const result = await run("Dress Shirt $6\nJeans $10", deps);
    expect(result.assistantMessage).toContain("service catalog tool failed");
    expect(result.state.status).toBe("collecting_details");
    expect(result.state.lastCompletedStep).toBe("website_confirmed");
  });

  it("does not advance state when availability write fails", async () => {
    const { deps } = makeDeps({
      session: baseSession({ status: "availability_setup", lastCompletedStep: "services_configured", missingFieldsJson: ["availability", "booking_rules"] }),
      services: [{ id: 1, tenantId: "default", vendorId: 7, serviceName: "Haircut", basePriceCents: 10000, durationMinutes: 60 }],
      failTools: { setVendorAvailabilityTool: "database unavailable" },
    });
    const result = await run("Tuesdays 2-6 PM in Century City.", deps);
    expect(result.assistantMessage).toContain("availability tool failed");
    expect(result.state.status).toBe("availability_setup");
    expect(result.state.lastCompletedStep).toBe("services_configured");
  });
});
