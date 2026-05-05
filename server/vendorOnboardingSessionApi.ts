import type { Request, Response, Router } from "express";
import { z } from "zod";
import type { Vendor, VendorAdminConfig, VendorOnboardingMessage, VendorOnboardingSession, VendorProfile } from "../drizzle/schema";
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
} from "./db";
import { detectVendorCategoryPreset, getVendorCategoryPreset, vendorOnboardingFirstQuestion } from "./agents/vendorCategoryPresets";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import {
  buildVendorOnboardingState,
  loadVendorOnboardingContextForSession,
  runVendorOnboardingTurn,
  type VendorOnboardingAgentDeps,
} from "./agents/vendorOnboardingAgent";

type OnboardingMessageRole = VendorOnboardingMessage["role"];

type LoadedSession = {
  tenantId: string;
  session: VendorOnboardingSession;
  vendor?: Vendor;
  profile?: VendorProfile;
  adminConfig?: VendorAdminConfig;
  services: Awaited<ReturnType<typeof listVendorServices>>;
  availability: Awaited<ReturnType<typeof listVendorAvailabilityWindows>>;
  messages: VendorOnboardingMessage[];
};

export type VendorOnboardingSessionDeps = {
  getSessionByToken: typeof getVendorOnboardingSessionByToken;
  getVendorById: typeof getVendorById;
  getVendorProfileByVendorId: typeof getVendorProfileByVendorId;
  getVendorAdminConfig: typeof getVendorAdminConfig;
  listServices: typeof listVendorServices;
  listAvailability: typeof listVendorAvailabilityWindows;
  listMessages: typeof listVendorOnboardingMessages;
  createMessage: typeof createVendorOnboardingMessage;
  updateSession: typeof updateVendorOnboardingSession;
  runTurn: typeof runVendorOnboardingTurn;
};

export const defaultVendorOnboardingSessionDeps: VendorOnboardingSessionDeps = {
  getSessionByToken: getVendorOnboardingSessionByToken,
  getVendorById,
  getVendorProfileByVendorId,
  getVendorAdminConfig,
  listServices: listVendorServices,
  listAvailability: listVendorAvailabilityWindows,
  listMessages: listVendorOnboardingMessages,
  createMessage: createVendorOnboardingMessage,
  updateSession: updateVendorOnboardingSession,
  runTurn: runVendorOnboardingTurn,
};

const sessionQuerySchema = z.object({
  session: z.string().min(8).max(128).regex(/^von_[A-Za-z0-9_-]+$/),
});

const messageBodySchema = z.object({
  session: z.string().min(8).max(128).regex(/^von_[A-Za-z0-9_-]+$/),
  message: z.string().trim().min(1).max(4000),
});

const liveSessionRateLimit = new Map<string, { count: number; resetAt: number }>();

function getIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown-ip";
}

function isLiveSessionRateLimited(req: Request, sessionToken: string, now = Date.now()) {
  const key = `${getIp(req)}:${sessionToken}`;
  const existing = liveSessionRateLimit.get(key);
  if (!existing || existing.resetAt <= now) {
    liveSessionRateLimit.set(key, { count: 1, resetAt: now + 60 * 1000 });
    return false;
  }
  existing.count += 1;
  return existing.count > 30;
}

function metadataObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function firstMessageByRole(messages: VendorOnboardingMessage[], role: OnboardingMessageRole) {
  return messages.find((message) => message.role === role);
}

function lastAgentMessage(messages: VendorOnboardingMessage[]) {
  return [...messages].reverse().find((message) => message.role === "agent");
}

function lastParsedFields(messages: VendorOnboardingMessage[]) {
  for (const message of [...messages].reverse()) {
    const parsedFields = metadataObject(message.metadataJson).parsedFields;
    if (parsedFields && typeof parsedFields === "object") return parsedFields;
  }
  return {};
}

function normalizedMissingFields(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function categoryPresetKeyFor(session: VendorOnboardingSession, profile?: VendorProfile, adminConfig?: VendorAdminConfig) {
  return adminConfig?.categoryPresetKey
    ?? (session.vendorCategory && getVendorCategoryPreset(session.vendorCategory).internalCategoryKey === session.vendorCategory
      ? session.vendorCategory
      : detectVendorCategoryPreset(profile?.vendorCategory ?? session.vendorCategory ?? ""));
}

function nextQuestionFor(loaded: LoadedSession): string {
  const lastAgent = lastAgentMessage(loaded.messages);
  const metadata = metadataObject(lastAgent?.metadataJson);
  if (typeof metadata.nextQuestion === "string") return metadata.nextQuestion;

  if (loaded.session.lastCompletedStep === "website_confirmed") {
    return "Tell me your core services, prices, and durations.";
  }

  if (loaded.session.publicSourceUrl) {
    return "I found your link. Do you want me to use it to prefill your services, pricing, hours, and brand details?";
  }

  return "What are your core services, prices, and durations?";
}

export function buildVendorOnboardingSessionState(loaded: LoadedSession) {
  const presetKey = categoryPresetKeyFor(loaded.session, loaded.profile, loaded.adminConfig);
  const preset = getVendorCategoryPreset(presetKey);
  const missingFields = normalizedMissingFields(loaded.session.missingFieldsJson);
  const sourceMessage = firstMessageByRole(loaded.messages, "system");
  const sourceMetadata = metadataObject(sourceMessage?.metadataJson);
  const businessName = loaded.profile?.businessName ?? loaded.vendor?.name ?? null;

  return {
    sessionToken: loaded.session.sessionId,
    sessionId: String(loaded.session.id),
    conversationId: loaded.session.conversationId ?? null,
    status: loaded.session.status,
    lastCompletedStep: loaded.session.lastCompletedStep ?? null,
    vendorCategory: loaded.profile?.vendorCategory ?? preset.visibleLabel.toLowerCase(),
    categoryPresetKey: preset.internalCategoryKey,
    businessName,
    websiteOrInstagram: loaded.session.publicSourceUrl ?? sourceMetadata.websiteOrInstagram ?? null,
    publicBookingSlug: loaded.adminConfig?.publicBookingSlug ?? loaded.vendor?.slug ?? null,
    firstQuestion: vendorOnboardingFirstQuestion,
    missingFields,
    nextQuestion: nextQuestionFor(loaded),
    parsedFields: lastParsedFields(loaded.messages),
  };
}

async function loadSessionOrRespond(
  req: Request,
  res: Response,
  sessionToken: string,
  deps: VendorOnboardingSessionDeps
): Promise<LoadedSession | null> {
  const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
  const session = await deps.getSessionByToken(tenantId, sessionToken);
  if (!session) {
    res.status(404).json({ ok: false, error: "Vendor onboarding session not found", code: "VENDOR_ONBOARDING_SESSION_NOT_FOUND" });
    return null;
  }

  const vendor = session.vendorId != null ? await deps.getVendorById(session.vendorId) : undefined;
  const profile = session.vendorId != null ? await deps.getVendorProfileByVendorId(tenantId, session.vendorId) : undefined;
  const adminConfig = session.vendorId != null ? await deps.getVendorAdminConfig(tenantId, session.vendorId) : undefined;
  const services = session.vendorId != null ? await deps.listServices(tenantId, session.vendorId) : [];
  const availability = session.vendorId != null ? await deps.listAvailability(tenantId, session.vendorId) : [];
  const messages = await deps.listMessages(tenantId, session.id);

  return { tenantId, session, vendor, profile, adminConfig, services, availability, messages };
}

export function createVendorOnboardingSessionHandlers(deps = defaultVendorOnboardingSessionDeps) {
  return {
    getSession: async (req: Request, res: Response) => {
      const parsed = sessionQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "Invalid session token", code: "VENDOR_ONBOARDING_BAD_SESSION" });
      }
      if (isLiveSessionRateLimited(req, parsed.data.session)) {
        return res.status(429).json({ ok: false, error: "Too many onboarding session requests", code: "VENDOR_ONBOARDING_RATE_LIMITED" });
      }

      const loaded = await loadSessionOrRespond(req, res, parsed.data.session, deps);
      if (!loaded) return;
      const context = await loadVendorOnboardingContextForSession(loaded.tenantId, parsed.data.session, deps as unknown as VendorOnboardingAgentDeps);
      return res.status(200).json({
        ok: true,
        session: {
          ...buildVendorOnboardingSessionState(loaded),
          ...(context ? buildVendorOnboardingState(context) : {}),
        },
      });
    },
    postMessage: async (req: Request, res: Response) => {
      const parsed = messageBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "Invalid onboarding message", code: "VENDOR_ONBOARDING_BAD_MESSAGE", issues: parsed.error.issues });
      }
      if (isLiveSessionRateLimited(req, parsed.data.session)) {
        return res.status(429).json({ ok: false, error: "Too many onboarding session requests", code: "VENDOR_ONBOARDING_RATE_LIMITED" });
      }

      const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
      const session = await deps.getSessionByToken(tenantId, parsed.data.session);
      if (!session) {
        return res.status(404).json({ ok: false, error: "Vendor onboarding session not found", code: "VENDOR_ONBOARDING_SESSION_NOT_FOUND" });
      }
      const result = await deps.runTurn({
        tenantId,
        sessionToken: parsed.data.session,
        message: parsed.data.message,
        actorIp: getIp(req),
      });

      return res.status(200).json({
        ok: true,
        assistantMessage: result.assistantMessage,
        state: result.state,
      });
    },
  };
}

export function registerVendorOnboardingSessionRoutes(router: Router, deps = defaultVendorOnboardingSessionDeps) {
  const handlers = createVendorOnboardingSessionHandlers(deps);
  router.get("/api/vendor-onboarding/session", handlers.getSession);
  router.post("/api/vendor-onboarding/message", handlers.postMessage);
}
