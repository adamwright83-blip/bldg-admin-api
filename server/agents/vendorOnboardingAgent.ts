import type {
  Vendor,
  VendorAdminConfig,
  VendorAvailabilityWindow,
  VendorOnboardingMessage,
  VendorOnboardingSession,
  VendorProfile,
  VendorService,
} from "../../drizzle/schema";
import {
  createVendorOnboardingMessage,
  getVendorAdminConfig,
  getVendorById,
  getVendorOnboardingSessionByToken,
  getVendorProfileByVendorId,
  listVendorAvailabilityWindows,
  listVendorOnboardingMessages,
  listVendorServices,
  updateVendorOnboardingSession,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { runAgentTool } from "./agentRuntime";
import { detectVendorCategoryPreset, getVendorCategoryPreset, vendorOnboardingFirstQuestion } from "./vendorCategoryPresets";

type OnboardingStatus = VendorOnboardingSession["status"];

export type VendorOnboardingToolCall = {
  toolName: string;
  input: Record<string, any>;
  requiresApproval?: boolean;
};

export type VendorOnboardingPlan = {
  intent: string;
  confidence: number;
  currentStep: string;
  nextStep: string;
  assistantMessage: string;
  toolCalls: VendorOnboardingToolCall[];
  statePatch: {
    status: OnboardingStatus;
    lastCompletedStep: string;
    missingFields: string[];
  };
  parsedFields: Record<string, any>;
  needsHumanClarification: boolean;
};

type VendorOnboardingContext = {
  tenantId: string;
  session: VendorOnboardingSession;
  vendor?: Vendor;
  profile?: VendorProfile;
  adminConfig?: VendorAdminConfig;
  services: VendorService[];
  availability: VendorAvailabilityWindow[];
  messages: VendorOnboardingMessage[];
  categoryPresetKey: string;
};

export type RunVendorOnboardingTurnInput = {
  tenantId: string;
  sessionToken: string;
  message: string;
  actorIp?: string;
};

export type RunVendorOnboardingTurnResult = {
  assistantMessage: string;
  state: ReturnType<typeof buildVendorOnboardingState>;
  toolResults: VendorOnboardingToolResult[];
  usedLLM: boolean;
  fallbackUsed: boolean;
};

type VendorOnboardingToolResult = {
  toolName: string;
  output: unknown;
  ok: boolean;
  errorMessage?: string;
};

export type VendorOnboardingAgentDeps = {
  getSessionByToken: typeof getVendorOnboardingSessionByToken;
  getVendorById: typeof getVendorById;
  getVendorProfileByVendorId: typeof getVendorProfileByVendorId;
  getVendorAdminConfig: typeof getVendorAdminConfig;
  listServices: typeof listVendorServices;
  listAvailability: typeof listVendorAvailabilityWindows;
  listMessages: typeof listVendorOnboardingMessages;
  createMessage: typeof createVendorOnboardingMessage;
  updateSession: typeof updateVendorOnboardingSession;
  runTool: typeof runAgentTool;
  invokePlan: (ctx: VendorOnboardingContext, vendorMessage: string) => Promise<VendorOnboardingPlan>;
};

export const vendorOnboardingAllowedTools = new Set([
  "prefillVendorFromWebTool",
  "createVendorProfileTool",
  "createVendorServiceCatalogTool",
  "setVendorAvailabilityTool",
  "configureVendorGeoClusteringTool",
  "configureVendorBookingRulesTool",
  "configureVendorAdminTool",
  "setVendorAdminThemeTool",
  "createVendorPricingRecommendationTool",
  "createVendorDirectBookingSessionTool",
  "createVendorGuestBookingSessionTool",
]);

export const defaultVendorOnboardingAgentDeps: VendorOnboardingAgentDeps = {
  getSessionByToken: getVendorOnboardingSessionByToken,
  getVendorById,
  getVendorProfileByVendorId,
  getVendorAdminConfig,
  listServices: listVendorServices,
  listAvailability: listVendorAvailabilityWindows,
  listMessages: listVendorOnboardingMessages,
  createMessage: createVendorOnboardingMessage,
  updateSession: updateVendorOnboardingSession,
  runTool: runAgentTool,
  invokePlan: invokeVendorOnboardingPlanner,
};

function metadataObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizedMissingFields(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function lastParsedFields(messages: VendorOnboardingMessage[]) {
  for (const message of [...messages].reverse()) {
    const parsedFields = metadataObject(message.metadataJson).parsedFields;
    if (parsedFields && typeof parsedFields === "object") return parsedFields;
  }
  return {};
}

function lastToolResults(messages: VendorOnboardingMessage[]) {
  for (const message of [...messages].reverse()) {
    const toolResults = metadataObject(message.metadataJson).toolResults;
    if (Array.isArray(toolResults)) return toolResults as VendorOnboardingToolResult[];
  }
  return [];
}

function lastAssistantNextQuestion(messages: VendorOnboardingMessage[]) {
  const agent = [...messages].reverse().find((message) => message.role === "agent");
  const nextQuestion = metadataObject(agent?.metadataJson).nextQuestion;
  return typeof nextQuestion === "string" ? nextQuestion : null;
}

function categoryPresetKeyFor(session: VendorOnboardingSession, profile?: VendorProfile, adminConfig?: VendorAdminConfig) {
  return adminConfig?.categoryPresetKey
    ?? (session.vendorCategory && getVendorCategoryPreset(session.vendorCategory).internalCategoryKey === session.vendorCategory
      ? session.vendorCategory
      : detectVendorCategoryPreset(profile?.vendorCategory ?? session.vendorCategory ?? ""));
}

function priceToCents(raw: string | undefined) {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function durationToMinutes(raw: string | undefined, unit?: string) {
  if (!raw) return 60;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 60;
  if (unit?.toLowerCase().startsWith("hour")) return Math.round(n * 60);
  return Math.round(n);
}

function titleCaseService(value: string) {
  const titled = value
    .replace(/[-–—]+/g, " ")
    .replace(/&/g, " & ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bAnd\b/g, "&");
  return titled
    .replace(/^Haircuts$/i, "Haircut")
    .replace(/^Blowouts$/i, "Blowout")
    .replace(/^Wash Fold(?: Dry)?$/i, "Wash & Fold")
    .replace(/^Fluff & Fold Same Day \/ Delivery$/i, "Fluff & Fold Same Day Delivery")
    .replace(/^Same Day Delivery$/i, "Same-Day Delivery");
}

export function parseServicesFromText(text: string) {
  const services: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  const push = (service: Record<string, any>) => {
    const serviceName = titleCaseService(String(service.serviceName ?? ""));
    if (!serviceName || seen.has(serviceName.toLowerCase())) return;
    seen.add(serviceName.toLowerCase());
    services.push({ ...service, serviceName });
  };

  if (/\bwash\s*(?:and|&)?\s*fold\b|\bwash fold\b/i.test(text)) {
    const price = text.match(/\$?(\d+(?:\.\d{1,2})?)\s*\/?\s*(?:lb|pound)/i)?.[1];
    push({
      serviceName: "Wash & Fold",
      basePriceCents: priceToCents(price),
      pricingUnit: "pound",
      durationMinutes: 15,
    });
  }
  const rugSection = text.match(/\brugs?\s+([^.;\n]+)/i)?.[1] ?? "";
  for (const rug of `${rugSection}\n${text}`.matchAll(/\b(extra large|small|medium|large)\s*\$?(\d+(?:\.\d{1,2})?)/gi)) {
    push({ serviceName: `Rug ${rug[1]}`, basePriceCents: priceToCents(rug[2]), durationMinutes: 15 });
  }
  const sleepingBagPrice = text.match(/\bsleeping bags?\s*\$?(\d+(?:\.\d{1,2})?)/i)?.[1];
  if (sleepingBagPrice) {
    push({ serviceName: "Sleeping Bag", basePriceCents: priceToCents(sleepingBagPrice), durationMinutes: 15 });
  }
  if (/\bsame[-\s]?day delivery\b/i.test(text)) {
    const sameDayText = text.match(/\bsame[-\s]?day delivery([^.;\n]*)/i)?.[1] ?? "";
    const price = sameDayText.match(/\$?(\d+(?:\.\d{1,2})?)/)?.[1];
    push({ serviceName: "Same-Day Delivery", basePriceCents: priceToCents(price), durationMinutes: 15, needsPriceClarification: !price });
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const nextPrice = next.match(/^\$?(\d+(?:\.\d{1,2})?)(?:\s*\/\s*(lb|pound))?$/i);
    if (nextPrice && /[A-Za-z]/.test(line) && !/^(premium|unmatched|prices?|delivery|same day|bedding & rugs)$/i.test(line)) {
      push({
        serviceName: line,
        basePriceCents: priceToCents(nextPrice[1]),
        pricingUnit: nextPrice[2] ? "pound" : undefined,
        durationMinutes: 60,
      });
      i += 1;
    }
  }

  const chunks = text.split(/[;\n]+|(?<!\d)\.(?!\d)/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const match = chunk.match(/^([A-Za-z][A-Za-z\s&/-]{2,60}?)(?:\s+starts\s+at|\s+is|\s+are|:)?\s+\$(\d+(?:\.\d{1,2})?)/i);
    if (!match) continue;
    const name = match[1].replace(/\b(starts at|is|are)\b/gi, "").trim();
    if (/wash|rug|sleeping|delivery/i.test(name)) continue;
    const afterPrice = chunk.slice((match.index ?? 0) + match[0].length);
    const durationMatch = afterPrice.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|hour|hours|hr|hrs)/i);
    push({
      serviceName: name,
      basePriceCents: priceToCents(match[2]),
      durationMinutes: durationToMinutes(durationMatch?.[1], durationMatch?.[2]),
      priceQualifier: /starts at/i.test(chunk) ? "starts_at" : undefined,
    });
  }
  return services;
}

function inferServiceCategories(services: Array<Record<string, any>>) {
  const labels = new Set<string>();
  for (const service of services) {
    const name = String(service.serviceName ?? "").toLowerCase();
    if (/wash|fold|fluff/.test(name)) labels.add("Wash & Fold");
    else if (/rug|comforter|sleeping|bedding|blanket|sheet|duvet/.test(name)) labels.add("Bedding & Rugs");
    else if (/shirt|blouse|top/.test(name)) labels.add("Tops");
    else if (/jean|pant|short/.test(name)) labels.add("Pants");
    else if (/dress|gown|skirt/.test(name)) labels.add("Dresses");
    else if (/coat|jacket|outerwear/.test(name)) labels.add("Outerwear");
    else if (/alter|hem|repair|tailor/.test(name)) labels.add("Alterations");
    else if (/tie|scarf|hat|bag|accessor/.test(name)) labels.add("Accessories");
    else if (/dry clean|press/.test(name)) labels.add("Dry Cleaning");
  }
  return Array.from(labels);
}

function parseAvailabilityFromText(text: string) {
  const lower = text.toLowerCase();
  const dayMap: Record<string, number> = {
    sunday: 0,
    sundays: 0,
    monday: 1,
    mondays: 1,
    tuesday: 2,
    tuesdays: 2,
    wednesday: 3,
    wednesdays: 3,
    thursday: 4,
    thursdays: 4,
    friday: 5,
    fridays: 5,
    saturday: 6,
    saturdays: 6,
  };
  let days: number[] = [];
  if (/\bweekdays\b/.test(lower)) days = [1, 2, 3, 4, 5];
  for (const [name, day] of Object.entries(dayMap)) {
    if (new RegExp(`\\b${name}\\b`).test(lower) && !days.includes(day)) days.push(day);
  }
  const range = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (days.length === 0 || !range) return [];

  const toTime = (hourText: string, minText: string | undefined, meridiem: string | undefined, fallbackMeridiem?: string) => {
    let hour = Number(hourText);
    const minute = Number(minText ?? 0);
    const suffix = meridiem ?? fallbackMeridiem;
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const endMeridiem = range[6];
  const startTime = toTime(range[1], range[2], range[3], endMeridiem);
  const endTime = toTime(range[4], range[5], endMeridiem, range[3]);
  const neighborhoods = text.match(/\b(?:in|for)\s+([A-Za-z\s,&-]+)$/i)?.[1]
    ?.split(/\s+and\s+|,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  return days.map((dayOfWeek) => ({
    dayOfWeek,
    startTime,
    endTime,
    timezone: "America/Los_Angeles",
    neighborhoodScope: neighborhoods?.length ? neighborhoods : null,
  }));
}

function parseBookingRulesFromText(text: string) {
  const lower = text.toLowerCase();
  const mode = /\b(auto|instant)\b/.test(lower)
    ? "instant"
    : /\b(approval|required|manual|ask me)\b/.test(lower)
      ? "manual"
      : "hybrid";
  return {
    bookingConfirmationMode: mode,
    cardOnFileRequired: /\bcard on file\b/.test(lower) ? true : undefined,
    depositPolicy: lower.match(/deposit[^.,;\n]*/)?.[0] ?? null,
    cancellationFee: lower.match(/cancel[^.,;\n]*/)?.[0] ?? null,
    noShowFee: lower.match(/no[-\s]?show[^.,;\n]*/)?.[0] ?? null,
  };
}

function extractUrlOrHandle(text: string) {
  const url = text.match(/https?:\/\/[^\s]+|www\.[^\s]+|instagram\.com\/[^\s]+/i)?.[0];
  if (url) return url.startsWith("http") ? url : `https://${url}`;
  const handle = text.match(/@[A-Za-z0-9_.-]{3,}/)?.[0];
  return handle ? `https://instagram.com/${handle.slice(1)}` : null;
}

function serviceSummary(services: Array<Record<string, any>>) {
  return services.map((service) => {
    const price = service.basePriceCents ? `$${(Number(service.basePriceCents) / 100).toFixed(Number(service.basePriceCents) % 100 ? 2 : 0)}` : "price TBD";
    const duration = service.durationMinutes ? `${service.durationMinutes} min` : "duration TBD";
    return `${service.serviceName} (${price}, ${duration})`;
  }).join(", ");
}

function existingServicesSummary(services: VendorService[]) {
  return services.map((service) => {
    const price = `$${(service.basePriceCents / 100).toFixed(service.basePriceCents % 100 ? 2 : 0)}`;
    return `${service.serviceName} (${price}, ${service.durationMinutes} min)`;
  }).join(", ");
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function prefillGroundedMessage(output: Record<string, any>) {
  const sourceUrl = String(output.sourceUrl ?? "the site");
  const status = output.extractionStatus ?? "failed";
  const services = Array.isArray(output.services) ? output.services : [];
  const businessDetails = metadataObject(output.businessDetails);
  if (status === "success" && services.length > 0) {
    return `I extracted ${pluralize(services.length, "service")} from ${sourceUrl}. Review these before I save them.`;
  }
  if (status === "partial" || Object.values(businessDetails).some(Boolean)) {
    return "I found your business details, but pricing was not visible. Paste your services/prices and I’ll structure them.";
  }
  return "I couldn’t extract usable pricing from the site. Paste your pricing and I’ll structure it.";
}

function serviceCatalogGroundedMessage(output: Record<string, any>, parsedFields: Record<string, any>, adminConfigured: boolean) {
  const count = Number(output.servicesCreated ?? (Array.isArray(output.serviceIds) ? output.serviceIds.length : 0));
  const categories = Array.isArray(parsedFields.serviceCategories) && parsedFields.serviceCategories.length > 0
    ? ` across ${parsedFields.serviceCategories.join(", ")}`
    : "";
  const adminCopy = adminConfigured
    ? " Your draft booking menu is created. The public booking page is not live until you approve and publish it."
    : "";
  return `I added ${count} services to your draft booking menu${categories}.${adminCopy} Next: when should BLDG.chat offer these services?`;
}

function safeQuestionMessage(plan: VendorOnboardingPlan, ctx: VendorOnboardingContext) {
  const copy = plan.assistantMessage;
  if (/\b(i'?m|i’m|i am|i’ll|i will|i)\s+(analyz|analyzed|extract|extracted|creat|created|configur|configured|sav|saved|build|built|organiz|organized|added)/i.test(copy)) {
    if (!ctx.session.publicSourceUrl) return "Send your website, Instagram, or current booking page.";
    if (ctx.services.length > 0) return `Your draft services are already saved: ${existingServicesSummary(ctx.services)}. Next, when should BLDG.chat offer these services?`;
    return "Paste your services, prices, and durations and I’ll structure them.";
  }
  return copy;
}

function serviceCatalogToolCalls(ctx: VendorOnboardingContext, services: Array<Record<string, any>>): VendorOnboardingToolCall[] {
  const toolCalls: VendorOnboardingToolCall[] = [
    { toolName: "createVendorServiceCatalogTool", input: { vendorId: ctx.session.vendorId, categoryPresetKey: ctx.categoryPresetKey, services }, requiresApproval: false },
  ];
  if (!ctx.adminConfig) {
    toolCalls.push(
      {
        toolName: "configureVendorAdminTool",
        input: {
          vendorId: ctx.session.vendorId,
          categoryPresetKey: ctx.categoryPresetKey,
          businessName: ctx.profile?.businessName ?? ctx.vendor?.name ?? "Draft Vendor",
          publicBookingSlug: ctx.vendor?.slug ?? undefined,
        },
        requiresApproval: false,
      },
      {
        toolName: "createVendorDirectBookingSessionTool",
        input: {
          vendorId: ctx.session.vendorId,
          brandName: ctx.profile?.businessName ?? ctx.vendor?.name ?? "Draft Vendor",
          publicBookingSlug: ctx.vendor?.slug ?? undefined,
        },
        requiresApproval: false,
      }
    );
  }
  return toolCalls;
}

function deterministicPlan(ctx: VendorOnboardingContext, vendorMessage: string): VendorOnboardingPlan {
  const parsedFields = lastParsedFields(ctx.messages);
  const previousServices = Array.isArray(parsedFields.services) ? parsedFields.services : [];
  const publicSourceUrl = ctx.session.publicSourceUrl ?? extractUrlOrHandle(vendorMessage);
  const saysYes = /\b(yes|yeah|yep|sure|ok|okay|please|use it|go ahead|correct|looks good|confirm|confirmed|save|add them|use these)\b/i.test(vendorMessage);
  const services = parseServicesFromText(vendorMessage);
  const availability = parseAvailabilityFromText(vendorMessage);
  const bookingRules = parseBookingRulesFromText(vendorMessage);
  const hasBookingRuleIntent = /\b(auto|instant|approval|required|manual|hybrid|deposit|card on file|cancel|no[-\s]?show)\b/i.test(vendorMessage);

  if (!ctx.session.publicSourceUrl && publicSourceUrl) {
    return {
      intent: "provide_link",
      confidence: 0.85,
      currentStep: ctx.session.status,
      nextStep: "collecting_details",
      assistantMessage: "I found your link. Do you want me to use it to prefill your services, pricing, hours, and brand details?",
      toolCalls: [],
      statePatch: { status: "started", lastCompletedStep: "source_link_collected", missingFields: ["source_confirmation", "services", "availability", "booking_rules"] },
      parsedFields: { ...parsedFields, websiteOrInstagram: publicSourceUrl },
      needsHumanClarification: true,
    };
  }

  if (ctx.session.publicSourceUrl && ctx.services.length === 0 && ctx.session.lastCompletedStep !== "website_confirmed" && saysYes) {
    return {
      intent: "approve_prefill",
      confidence: 0.9,
      currentStep: ctx.session.status,
      nextStep: "collecting_details",
      assistantMessage: "I’ll use that link for a first pass. If I can’t pull a full menu from it, send your core services, prices, and durations.",
      toolCalls: [{ toolName: "prefillVendorFromWebTool", input: { sourceUrl: ctx.session.publicSourceUrl }, requiresApproval: false }],
      statePatch: { status: "collecting_details", lastCompletedStep: "website_confirmed", missingFields: ["services", "pricing", "durations", "availability", "booking_rules"] },
      parsedFields: { ...parsedFields, websiteOrInstagram: ctx.session.publicSourceUrl, prefillApproved: true },
      needsHumanClarification: true,
    };
  }

  if (services.length > 0 && ctx.session.vendorId != null) {
    const toolCalls = serviceCatalogToolCalls(ctx, services);
    return {
      intent: "provide_services",
      confidence: 0.88,
      currentStep: ctx.session.status,
      nextStep: "availability_setup",
      assistantMessage: `I added these services to your draft booking menu: ${serviceSummary(services)}. Next, when should BLDG.chat offer these services?`,
      toolCalls,
      statePatch: { status: "availability_setup", lastCompletedStep: "services_configured", missingFields: ["availability", "booking_rules"] },
      parsedFields: { ...parsedFields, services, serviceCategories: inferServiceCategories(services) },
      needsHumanClarification: true,
    };
  }

  if (ctx.services.length === 0 && previousServices.length > 0 && saysYes && ctx.session.vendorId != null) {
    const servicesToSave = previousServices.map((service) => metadataObject(service));
    const toolCalls = serviceCatalogToolCalls(ctx, servicesToSave);
    return {
      intent: "confirm_prefilled_services",
      confidence: 0.88,
      currentStep: ctx.session.status,
      nextStep: "availability_setup",
      assistantMessage: "I added the reviewed services to your draft booking menu. Next, when should BLDG.chat offer these services?",
      toolCalls,
      statePatch: { status: "availability_setup", lastCompletedStep: "services_configured", missingFields: ["availability", "booking_rules"] },
      parsedFields: { ...parsedFields, services: servicesToSave, serviceCategories: inferServiceCategories(servicesToSave) },
      needsHumanClarification: true,
    };
  }

  if (ctx.services.length > 0 && availability.length > 0 && ctx.session.vendorId != null) {
    return {
      intent: "provide_availability",
      confidence: 0.86,
      currentStep: ctx.session.status,
      nextStep: "booking_rules",
      assistantMessage: "I saved that draft availability. Should normal bookings auto-confirm, require your approval, or use hybrid confirmation?",
      toolCalls: [{ toolName: "setVendorAvailabilityTool", input: { vendorId: ctx.session.vendorId, windows: availability, trafficProtectionMode: "geo_clustered" }, requiresApproval: false }],
      statePatch: { status: "pricing_setup", lastCompletedStep: "availability_configured", missingFields: ["booking_rules"] },
      parsedFields: { ...parsedFields, availability },
      needsHumanClarification: true,
    };
  }

  if (ctx.availability.length > 0 && hasBookingRuleIntent && ctx.session.vendorId != null) {
    return {
      intent: "provide_booking_rules",
      confidence: 0.84,
      currentStep: ctx.session.status,
      nextStep: "review",
      assistantMessage: "Your draft vendor setup is configured. I’ll keep it offline until you approve it.",
      toolCalls: [{ toolName: "configureVendorBookingRulesTool", input: { vendorId: ctx.session.vendorId, ...bookingRules }, requiresApproval: false }],
      statePatch: { status: "admin_configured", lastCompletedStep: "booking_rules_configured", missingFields: [] },
      parsedFields: { ...parsedFields, bookingRules },
      needsHumanClarification: false,
    };
  }

  if (!ctx.session.publicSourceUrl) {
    return {
      intent: "request_link",
      confidence: 0.8,
      currentStep: ctx.session.status,
      nextStep: "source_link",
      assistantMessage: "Send your website, Instagram, or current booking page.",
      toolCalls: [],
      statePatch: { status: "started", lastCompletedStep: ctx.session.lastCompletedStep ?? "source_requested", missingFields: ["websiteOrInstagram", "services", "availability", "booking_rules"] },
      parsedFields,
      needsHumanClarification: true,
    };
  }

  if (ctx.services.length > 0) {
    return {
      intent: "request_availability",
      confidence: 0.8,
      currentStep: ctx.session.status,
      nextStep: "availability_setup",
      assistantMessage: `Your draft services are already saved: ${existingServicesSummary(ctx.services)}. Next, when should BLDG.chat offer these services?`,
      toolCalls: [],
      statePatch: { status: "availability_setup", lastCompletedStep: "services_configured", missingFields: ["availability", "booking_rules"] },
      parsedFields,
      needsHumanClarification: true,
    };
  }

  return {
    intent: "request_services",
    confidence: 0.72,
    currentStep: ctx.session.status,
    nextStep: "collecting_details",
    assistantMessage: "Tell me your core services, prices, and durations. You can write it messily; I’ll turn it into a draft booking menu.",
    toolCalls: [],
    statePatch: { status: "collecting_details", lastCompletedStep: ctx.session.lastCompletedStep ?? "services_requested", missingFields: ["services", "pricing", "durations", "availability", "booking_rules"] },
    parsedFields,
    needsHumanClarification: true,
  };
}

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "currentStep", "nextStep", "assistantMessage", "toolCalls", "statePatch", "parsedFields", "needsHumanClarification"],
  properties: {
    intent: { type: "string" },
    confidence: { type: "number" },
    currentStep: { type: "string" },
    nextStep: { type: "string" },
    assistantMessage: { type: "string" },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["toolName", "input", "requiresApproval"],
        properties: {
          toolName: { type: "string" },
          input: { type: "object" },
          requiresApproval: { type: "boolean" },
        },
      },
    },
    statePatch: {
      type: "object",
      additionalProperties: false,
      required: ["status", "lastCompletedStep", "missingFields"],
      properties: {
        status: { type: "string" },
        lastCompletedStep: { type: "string" },
        missingFields: { type: "array", items: { type: "string" } },
      },
    },
    parsedFields: { type: "object" },
    needsHumanClarification: { type: "boolean" },
  },
};

async function invokeVendorOnboardingPlanner(ctx: VendorOnboardingContext, vendorMessage: string): Promise<VendorOnboardingPlan> {
  const availableTools = Array.from(vendorOnboardingAllowedTools);
  const preset = getVendorCategoryPreset(ctx.categoryPresetKey);
  const priorConversation = ctx.messages.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n");
  const callPlanner = async (correction?: string) => invokeLLM({
    tenantId: ctx.tenantId,
    model: ENV.anthropicModelVendorOnboarding || ENV.anthropicModel,
    temperature: 0,
    maxTokens: 2500,
    outputSchema: { name: "vendor_onboarding_plan", schema: planSchema, strict: true },
    messages: [
      {
        role: "system",
        content: [
          "You are vendorOnboardingAgent for BLDG.chat. Return JSON only through the structured schema.",
          "You do not mutate the database. You recommend tool calls. The backend executes only registered approved tools.",
          "Never activate a vendor publicly, charge payment, send SMS/email, expose other vendors, or request cross-vendor data.",
          "Never claim you are doing, analyzing, extracting, creating, configuring, saving, or building something. Only ask for missing input or recommend tool calls; backend will write grounded copy after tools finish.",
          "Ask one clear next question. Do not repeat the services question when services already exist.",
          "Parse messy business text into services, prices in cents, durations in minutes, availability windows, and booking rules.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          currentState: {
            status: ctx.session.status,
            lastCompletedStep: ctx.session.lastCompletedStep,
            missingFields: normalizedMissingFields(ctx.session.missingFieldsJson),
            parsedConversationState: lastParsedFields(ctx.messages),
            previousToolResults: lastToolResults(ctx.messages),
            publicSourceUrl: ctx.session.publicSourceUrl,
            vendorId: ctx.session.vendorId,
            vendor: ctx.vendor,
            profile: ctx.profile,
            services: ctx.services,
            availability: ctx.availability,
            adminConfig: ctx.adminConfig,
          },
          categoryPreset: preset,
          priorConversation,
          vendorMessage,
          availableTools,
          requiredFlow: "link -> services -> availability -> booking_rules -> review",
          correction,
        }),
      },
    ],
  });

  const parseResult = (result: Awaited<ReturnType<typeof callPlanner>>) => {
    const content = result.choices[0]?.message.content;
    return JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as VendorOnboardingPlan;
  };

  try {
    return parseResult(await callPlanner());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return parseResult(await callPlanner("Your previous response was invalid JSON for the required schema. Return only valid structured JSON."));
  }
}

function sanitizePlan(rawPlan: VendorOnboardingPlan, ctx: VendorOnboardingContext): VendorOnboardingPlan {
  const fallback = deterministicPlan(ctx, "");
  const validStatuses = new Set(["started", "collecting_details", "pricing_setup", "availability_setup", "payment_setup", "admin_configured", "completed", "abandoned"]);
  const statePatch = rawPlan.statePatch ?? fallback.statePatch;
  const toolCalls = Array.isArray(rawPlan.toolCalls)
    ? rawPlan.toolCalls
        .filter((call) => vendorOnboardingAllowedTools.has(call.toolName))
        .filter((call) => call.requiresApproval !== true)
        .map((call) => ({
          toolName: call.toolName,
          input: {
            ...metadataObject(call.input),
            ...(ctx.session.vendorId != null && call.toolName !== "prefillVendorFromWebTool" ? { vendorId: ctx.session.vendorId } : {}),
          },
          requiresApproval: false,
        }))
    : [];
  if (!ctx.adminConfig && toolCalls.some((call) => call.toolName === "createVendorServiceCatalogTool") && ctx.session.vendorId != null) {
    const hasAdmin = toolCalls.some((call) => call.toolName === "configureVendorAdminTool");
    const hasDirectSession = toolCalls.some((call) => call.toolName === "createVendorDirectBookingSessionTool");
    if (!hasAdmin) {
      toolCalls.push({
        toolName: "configureVendorAdminTool",
        input: {
          vendorId: ctx.session.vendorId,
          categoryPresetKey: ctx.categoryPresetKey,
          businessName: ctx.profile?.businessName ?? ctx.vendor?.name ?? "Draft Vendor",
          publicBookingSlug: ctx.vendor?.slug ?? undefined,
        },
        requiresApproval: false,
      });
    }
    if (!hasDirectSession) {
      toolCalls.push({
        toolName: "createVendorDirectBookingSessionTool",
        input: {
          vendorId: ctx.session.vendorId,
          brandName: ctx.profile?.businessName ?? ctx.vendor?.name ?? "Draft Vendor",
          publicBookingSlug: ctx.vendor?.slug ?? undefined,
        },
        requiresApproval: false,
      });
    }
  }
  return {
    intent: String(rawPlan.intent ?? fallback.intent),
    confidence: Number(rawPlan.confidence ?? fallback.confidence),
    currentStep: String(rawPlan.currentStep ?? ctx.session.status),
    nextStep: String(rawPlan.nextStep ?? fallback.nextStep),
    assistantMessage: String(rawPlan.assistantMessage ?? fallback.assistantMessage).slice(0, 2000),
    toolCalls,
    statePatch: {
      status: (validStatuses.has(statePatch.status) ? statePatch.status : fallback.statePatch.status) as OnboardingStatus,
      lastCompletedStep: String(statePatch.lastCompletedStep ?? fallback.statePatch.lastCompletedStep).slice(0, 128),
      missingFields: Array.isArray(statePatch.missingFields) ? statePatch.missingFields.filter((field) => typeof field === "string") : fallback.statePatch.missingFields,
    },
    parsedFields: metadataObject(rawPlan.parsedFields),
    needsHumanClarification: rawPlan.needsHumanClarification !== false,
  };
}

async function loadContext(tenantId: string, sessionToken: string, deps: VendorOnboardingAgentDeps): Promise<VendorOnboardingContext | null> {
  const session = await deps.getSessionByToken(tenantId, sessionToken);
  if (!session) return null;
  const vendor = session.vendorId != null ? await deps.getVendorById(session.vendorId) : undefined;
  const profile = session.vendorId != null ? await deps.getVendorProfileByVendorId(tenantId, session.vendorId) : undefined;
  const adminConfig = session.vendorId != null ? await deps.getVendorAdminConfig(tenantId, session.vendorId) : undefined;
  const services = session.vendorId != null ? await deps.listServices(tenantId, session.vendorId) : [];
  const availability = session.vendorId != null ? await deps.listAvailability(tenantId, session.vendorId) : [];
  const messages = await deps.listMessages(tenantId, session.id);
  return {
    tenantId,
    session,
    vendor,
    profile,
    adminConfig,
    services,
    availability,
    messages,
    categoryPresetKey: categoryPresetKeyFor(session, profile, adminConfig),
  };
}

export function buildVendorOnboardingState(ctx: VendorOnboardingContext, plan?: VendorOnboardingPlan, toolResults: VendorOnboardingToolResult[] = []) {
  const prefillOutput = toolResults.find((result) => result.ok && result.toolName === "prefillVendorFromWebTool")?.output as Record<string, any> | undefined;
  const servicesFromPlan = Array.isArray(plan?.parsedFields?.services) ? plan?.parsedFields.services : undefined;
  const services = ctx.services.length > 0
    ? ctx.services
    : Array.isArray(servicesFromPlan) ? servicesFromPlan : Array.isArray(prefillOutput?.services) ? prefillOutput.services : undefined;
  const availability = ctx.availability.length > 0
    ? ctx.availability
    : Array.isArray(plan?.parsedFields?.availability) ? plan?.parsedFields.availability : undefined;
  const nextQuestion = plan?.assistantMessage
    ?? lastAssistantNextQuestion(ctx.messages)
    ?? (ctx.session.publicSourceUrl ? "I found your link. Do you want me to use it to prefill your services, pricing, hours, and brand details?" : vendorOnboardingFirstQuestion);

  return {
    status: plan?.statePatch.status ?? ctx.session.status,
    lastCompletedStep: plan?.statePatch.lastCompletedStep ?? ctx.session.lastCompletedStep ?? null,
    nextQuestion,
    parsedFields: { ...lastParsedFields(ctx.messages), ...(plan?.parsedFields ?? {}), ...(prefillOutput ? { prefill: prefillOutput } : {}) },
    missingFields: plan?.statePatch.missingFields ?? normalizedMissingFields(ctx.session.missingFieldsJson),
    services,
    availability,
    bookingRules: plan?.parsedFields?.bookingRules,
  };
}

export async function runVendorOnboardingTurn(
  input: RunVendorOnboardingTurnInput,
  deps = defaultVendorOnboardingAgentDeps
): Promise<RunVendorOnboardingTurnResult> {
  let ctx = await loadContext(input.tenantId, input.sessionToken, deps);
  if (!ctx) throw new Error("Vendor onboarding session not found");

  await deps.createMessage({
    tenantId: input.tenantId,
    sessionId: ctx.session.id,
    conversationId: ctx.session.conversationId ?? null,
    role: "vendor",
    content: input.message,
    metadataJson: { actorIp: input.actorIp ?? null },
  });

  const url = extractUrlOrHandle(input.message);
  if (!ctx.session.publicSourceUrl && url) {
    await deps.updateSession(input.tenantId, ctx.session.id, {
      publicSourceUrl: url,
      lastCompletedStep: "source_link_collected",
      missingFieldsJson: ["source_confirmation", "services", "availability", "booking_rules"],
    });
    ctx = await loadContext(input.tenantId, input.sessionToken, deps);
    if (!ctx) throw new Error("Vendor onboarding session not found");
  }

  let usedLLM = false;
  let fallbackUsed = false;
  let plan: VendorOnboardingPlan;
  try {
    plan = sanitizePlan(await deps.invokePlan(ctx, input.message), ctx);
    usedLLM = true;
  } catch (error) {
    console.warn("[VendorOnboardingAgent] LLM planner failed; using deterministic fallback", error instanceof Error ? error.message : String(error));
    fallbackUsed = true;
    plan = deterministicPlan(ctx, input.message);
  }

  const toolResults: VendorOnboardingToolResult[] = [];
  for (const call of plan.toolCalls) {
    try {
      const output = await deps.runTool(call.toolName, call.input, {
        tenantId: input.tenantId,
        sessionId: ctx.session.sessionId,
        conversationId: ctx.session.conversationId,
        agentType: "vendor_agent",
        actorType: "ai_agent",
        actorId: "vendor_onboarding_agent",
      });
      toolResults.push({ toolName: call.toolName, output, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toolResults.push({
        toolName: call.toolName,
        ok: false,
        errorMessage: message,
        output: { ok: false, errorMessage: message },
      });
      if (call.toolName === "createVendorServiceCatalogTool") break;
    }
  }

  let assistantMessage = safeQuestionMessage(plan, ctx);
  const failedServiceCatalog = toolResults.find((result) => !result.ok && result.toolName === "createVendorServiceCatalogTool");
  const failedAvailability = toolResults.find((result) => !result.ok && result.toolName === "setVendorAvailabilityTool");
  const failedBookingRules = toolResults.find((result) => !result.ok && result.toolName === "configureVendorBookingRulesTool");
  const prefillOutput = toolResults.find((result) => result.toolName === "prefillVendorFromWebTool")?.output as Record<string, any> | undefined;
  if (prefillOutput) {
    assistantMessage = prefillGroundedMessage(prefillOutput);
    plan.parsedFields = { ...plan.parsedFields, services: prefillOutput.services, prefill: prefillOutput };
  }
  const serviceCatalogOutput = toolResults.find((result) => result.ok && result.toolName === "createVendorServiceCatalogTool")?.output as Record<string, any> | undefined;
  if (serviceCatalogOutput) {
    const adminConfigured = toolResults.some((result) => result.ok && result.toolName === "configureVendorAdminTool");
    assistantMessage = serviceCatalogGroundedMessage(serviceCatalogOutput, plan.parsedFields, adminConfigured);
  }
  if (failedServiceCatalog) {
    assistantMessage = `I tried to save those services, but the service catalog tool failed: ${failedServiceCatalog.errorMessage}. Nothing was marked complete.`;
    plan.statePatch = {
      status: ctx.session.status,
      lastCompletedStep: ctx.session.lastCompletedStep ?? "services_save_failed",
      missingFields: normalizedMissingFields(ctx.session.missingFieldsJson),
    };
  }
  if (failedAvailability) {
    assistantMessage = `I tried to save that availability, but the availability tool failed: ${failedAvailability.errorMessage}. Nothing was marked complete.`;
    plan.statePatch = {
      status: ctx.session.status,
      lastCompletedStep: ctx.session.lastCompletedStep ?? "availability_save_failed",
      missingFields: normalizedMissingFields(ctx.session.missingFieldsJson),
    };
  }
  if (failedBookingRules) {
    assistantMessage = `I tried to save those booking rules, but the booking rules tool failed: ${failedBookingRules.errorMessage}. Nothing was marked complete.`;
    plan.statePatch = {
      status: ctx.session.status,
      lastCompletedStep: ctx.session.lastCompletedStep ?? "booking_rules_save_failed",
      missingFields: normalizedMissingFields(ctx.session.missingFieldsJson),
    };
  }
  const availabilityOutput = toolResults.find((result) => result.ok && result.toolName === "setVendorAvailabilityTool")?.output as Record<string, any> | undefined;
  if (availabilityOutput) {
    assistantMessage = "I saved that draft availability. Should normal bookings auto-confirm, require your approval, or use hybrid confirmation?";
  }
  const bookingRulesOutput = toolResults.find((result) => result.ok && result.toolName === "configureVendorBookingRulesTool")?.output as Record<string, any> | undefined;
  if (bookingRulesOutput) {
    assistantMessage = "Your draft vendor setup is configured. I’ll keep it offline until you approve it.";
  }
  plan.assistantMessage = assistantMessage;

  await deps.updateSession(input.tenantId, ctx.session.id, {
    status: plan.statePatch.status,
    lastCompletedStep: plan.statePatch.lastCompletedStep,
    missingFieldsJson: plan.statePatch.missingFields,
  });

  await deps.createMessage({
    tenantId: input.tenantId,
    sessionId: ctx.session.id,
    conversationId: ctx.session.conversationId ?? null,
    role: "agent",
    content: assistantMessage,
    metadataJson: {
      intent: plan.intent,
      confidence: plan.confidence,
      nextQuestion: assistantMessage,
      parsedFields: plan.parsedFields,
      missingFields: plan.statePatch.missingFields,
      lastCompletedStep: plan.statePatch.lastCompletedStep,
      usedLLM,
      fallbackUsed,
      toolResults,
    },
  });

  const refreshed = await loadContext(input.tenantId, input.sessionToken, deps);
  return {
    assistantMessage,
    state: buildVendorOnboardingState(refreshed ?? ctx, plan, toolResults),
    toolResults,
    usedLLM,
    fallbackUsed,
  };
}

export async function loadVendorOnboardingContextForSession(
  tenantId: string,
  sessionToken: string,
  deps = defaultVendorOnboardingAgentDeps
) {
  return loadContext(tenantId, sessionToken, deps);
}
