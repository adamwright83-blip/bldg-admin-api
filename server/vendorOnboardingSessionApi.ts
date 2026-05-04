import type { Request, Response, Router } from "express";
import { z } from "zod";
import type { Vendor, VendorAdminConfig, VendorOnboardingMessage, VendorOnboardingSession, VendorProfile } from "../drizzle/schema";
import {
  createVendorOnboardingMessage,
  getVendorAdminConfig,
  getVendorById,
  getVendorOnboardingSessionByToken,
  getVendorProfileByVendorId,
  listVendorOnboardingMessages,
  updateVendorOnboardingSession,
} from "./db";
import { runAgentTool } from "./agents/agentRuntime";
import { detectVendorCategoryPreset, getVendorCategoryPreset, vendorOnboardingFirstQuestion } from "./agents/vendorCategoryPresets";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";

type OnboardingStatus = VendorOnboardingSession["status"];
type OnboardingMessageRole = VendorOnboardingMessage["role"];

type LoadedSession = {
  tenantId: string;
  session: VendorOnboardingSession;
  vendor?: Vendor;
  profile?: VendorProfile;
  adminConfig?: VendorAdminConfig;
  messages: VendorOnboardingMessage[];
};

export type VendorOnboardingSessionDeps = {
  getSessionByToken: typeof getVendorOnboardingSessionByToken;
  getVendorById: typeof getVendorById;
  getVendorProfileByVendorId: typeof getVendorProfileByVendorId;
  getVendorAdminConfig: typeof getVendorAdminConfig;
  listMessages: typeof listVendorOnboardingMessages;
  createMessage: typeof createVendorOnboardingMessage;
  updateSession: typeof updateVendorOnboardingSession;
  runTool: typeof runAgentTool;
};

export const defaultVendorOnboardingSessionDeps: VendorOnboardingSessionDeps = {
  getSessionByToken: getVendorOnboardingSessionByToken,
  getVendorById,
  getVendorProfileByVendorId,
  getVendorAdminConfig,
  listMessages: listVendorOnboardingMessages,
  createMessage: createVendorOnboardingMessage,
  updateSession: updateVendorOnboardingSession,
  runTool: runAgentTool,
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
  const messages = await deps.listMessages(tenantId, session.id);

  return { tenantId, session, vendor, profile, adminConfig, messages };
}

function buildAssistantStep(loaded: LoadedSession, vendorMessage: string) {
  const text = vendorMessage.toLowerCase();
  const yes = /\b(yes|yeah|yep|sure|ok|okay|please|use it|go ahead|correct)\b/.test(text);
  const no = /\b(no|nope|don't|do not|manual|skip)\b/.test(text);
  const parsedFields = lastParsedFields(loaded.messages);

  if (loaded.session.publicSourceUrl && loaded.session.lastCompletedStep !== "website_confirmed" && yes) {
    return {
      status: "collecting_details" as OnboardingStatus,
      lastCompletedStep: "website_confirmed",
      missingFields: ["services", "pricing", "durations"],
      assistantMessage: "I’ll prepare the setup from your link. For now, tell me your core services, prices, and durations.",
      nextQuestion: "What are your core services, prices, and durations?",
      parsedFields: { ...parsedFields, websiteOrInstagram: loaded.session.publicSourceUrl, prefillApproved: true },
      toolCall: {
        toolName: "prefillVendorFromWebTool",
        input: { sourceUrl: loaded.session.publicSourceUrl },
      },
    };
  }

  if (loaded.session.publicSourceUrl && loaded.session.lastCompletedStep !== "website_confirmed" && no) {
    return {
      status: "collecting_details" as OnboardingStatus,
      lastCompletedStep: "manual_details_requested",
      missingFields: ["services", "pricing", "durations"],
      assistantMessage: "No problem. Tell me your core services, prices, and durations.",
      nextQuestion: "What are your core services, prices, and durations?",
      parsedFields: { ...parsedFields, prefillApproved: false },
      toolCall: null,
    };
  }

  return {
    status: "collecting_details" as OnboardingStatus,
    lastCompletedStep: loaded.session.lastCompletedStep ?? "collecting_details",
    missingFields: ["services", "pricing", "durations"],
    assistantMessage: "Got it. To set up your booking menu, tell me your core services, prices, and durations.",
    nextQuestion: "What are your core services, prices, and durations?",
    parsedFields,
    toolCall: null,
  };
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
      return res.status(200).json({ ok: true, session: buildVendorOnboardingSessionState(loaded) });
    },
    postMessage: async (req: Request, res: Response) => {
      const parsed = messageBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "Invalid onboarding message", code: "VENDOR_ONBOARDING_BAD_MESSAGE", issues: parsed.error.issues });
      }
      if (isLiveSessionRateLimited(req, parsed.data.session)) {
        return res.status(429).json({ ok: false, error: "Too many onboarding session requests", code: "VENDOR_ONBOARDING_RATE_LIMITED" });
      }

      const loaded = await loadSessionOrRespond(req, res, parsed.data.session, deps);
      if (!loaded) return;

      await deps.createMessage({
        tenantId: loaded.tenantId,
        sessionId: loaded.session.id,
        conversationId: loaded.session.conversationId ?? null,
        role: "vendor",
        content: parsed.data.message,
        metadataJson: null,
      });

      const step = buildAssistantStep(loaded, parsed.data.message);
      await deps.updateSession(loaded.tenantId, loaded.session.id, {
        status: step.status,
        lastCompletedStep: step.lastCompletedStep,
        missingFieldsJson: step.missingFields,
      });

      if (step.toolCall) {
        const output = await deps.runTool(step.toolCall.toolName, step.toolCall.input, {
            tenantId: loaded.tenantId,
            sessionId: loaded.session.sessionId,
            conversationId: loaded.session.conversationId,
            agentType: "vendor_agent",
            actorType: "ai_agent",
            actorId: "vendor_onboarding_live_session",
          });
        step.parsedFields = { ...step.parsedFields, prefill: output };
      }

      await deps.createMessage({
        tenantId: loaded.tenantId,
        sessionId: loaded.session.id,
        conversationId: loaded.session.conversationId ?? null,
        role: "agent",
        content: step.assistantMessage,
        metadataJson: {
          nextQuestion: step.nextQuestion,
          parsedFields: step.parsedFields,
          missingFields: step.missingFields,
          lastCompletedStep: step.lastCompletedStep,
        },
      });

      return res.status(200).json({
        ok: true,
        assistantMessage: step.assistantMessage,
        state: {
          status: step.status,
          lastCompletedStep: step.lastCompletedStep,
          nextQuestion: step.nextQuestion,
          parsedFields: step.parsedFields,
          missingFields: step.missingFields,
        },
      });
    },
  };
}

export function registerVendorOnboardingSessionRoutes(router: Router, deps = defaultVendorOnboardingSessionDeps) {
  const handlers = createVendorOnboardingSessionHandlers(deps);
  router.get("/api/vendor-onboarding/session", handlers.getSession);
  router.post("/api/vendor-onboarding/message", handlers.postMessage);
}
