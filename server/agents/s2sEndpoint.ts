import crypto from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { logAgentEvent } from "./agentEvents";
import { runAgentTool } from "./agentRuntime";
import type { ActorType, AgentContext, AgentType } from "./permissions";

export const s2sAgentToolAllowlist = new Set([
  "createLaundryOrderTool",
  "getResidentContextTool",
  "draftCustomerMessageTool",
  "createResidentAgentPlanTool",
  "updateResidentAgentPlanTool",
  "createResidentCoordinatedRequestTool",
  "createOrderFollowupTaskTool",
  "createVendorOnboardingSessionTool",
  "prefillVendorFromWebTool",
  "collectVendorDetailsTool",
  "createVendorProfileTool",
  "createVendorServiceCatalogTool",
  "setVendorAvailabilityTool",
  "configureVendorGeoClusteringTool",
  "configureVendorBookingRulesTool",
  "configureVendorAdminTool",
  "createVendorPricingRecommendationTool",
  "createVendorDirectBookingSessionTool",
  "createVendorGuestBookingSessionTool",
  "createVendorPeerServiceRequestTool",
  "searchNetworkVendorsTool",
  "exportVendorDataTool",
  "createVendorAdminCommandTool",
  "logVendorOnboardingAbandonmentTool",
  "scanAbandonedVendorOnboardingSessionsTool",
  "importCleanCloudOrdersTool",
  "importClearentTransactionsTool",
]);

const agentTypes = [
  "resident_agent",
  "operator_voice_agent",
  "vendor_agent",
  "driver_agent",
  "gm_agent",
  "building_agent",
  "collections_agent",
] as const;

const actorTypes = [
  "human",
  "voice",
  "resident_chat",
  "driver",
  "vendor",
  "ai_agent",
  "system",
] as const;

const runToolBodySchema = z.object({
  toolName: z.string().min(1),
  agentType: z.enum(agentTypes).default("resident_agent"),
  tenantId: z.string().min(1).default("default"),
  sessionId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  actorType: z.enum(actorTypes).default("resident_chat"),
  actorId: z.string().optional().nullable(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export type AgentS2SRunToolBody = z.infer<typeof runToolBodySchema>;

function getHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function isValidAgentSharedSecret(
  providedSecret: string | string[] | undefined,
  expectedSecret = process.env.ADMIN_AGENT_SHARED_SECRET ?? ""
): boolean {
  const provided = getHeaderValue(providedSecret);
  if (!expectedSecret || !provided) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function contextFromBody(body: AgentS2SRunToolBody): AgentContext {
  return {
    tenantId: body.tenantId,
    sessionId: body.sessionId ?? null,
    conversationId: body.conversationId ?? null,
    agentType: body.agentType as AgentType,
    actorType: body.actorType as ActorType,
    actorId: body.actorId ?? null,
  };
}

export function createAgentS2SRunToolHandler(deps?: {
  runTool?: typeof runAgentTool;
  logEvent?: typeof logAgentEvent;
}) {
  const runTool = deps?.runTool ?? runAgentTool;
  const logEvent = deps?.logEvent ?? logAgentEvent;

  return async function agentS2SRunToolHandler(req: Request, res: Response) {
    if (!isValidAgentSharedSecret(req.headers["x-agent-shared-secret"])) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "AGENT_S2S_UNAUTHORIZED",
      });
    }

    const parsed = runToolBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        code: "AGENT_S2S_BAD_REQUEST",
        issues: parsed.error.issues,
      });
    }

    const body = parsed.data;
    const ctx = contextFromBody(body);

    if (!s2sAgentToolAllowlist.has(body.toolName)) {
      await logEvent({
        ctx,
        toolName: body.toolName,
        inputJson: body.input,
        outputJson: { allowed: false, reason: "Tool is not allowlisted for S2S agent calls" },
        status: "blocked",
        errorMessage: "Tool is not allowlisted for S2S agent calls",
      });
      return res.status(403).json({
        error: "Forbidden",
        code: "AGENT_S2S_TOOL_FORBIDDEN",
        message: "Tool is not allowlisted for S2S agent calls",
      });
    }

    try {
      const output = await runTool(body.toolName, body.input, ctx);
      return res.status(200).json(output);
    } catch (error) {
      return res.status(500).json({
        error: "Tool execution failed",
        code: "AGENT_TOOL_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
