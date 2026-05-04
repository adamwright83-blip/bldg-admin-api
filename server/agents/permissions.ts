export type AgentType =
  | "resident_agent"
  | "operator_voice_agent"
  | "vendor_agent"
  | "driver_agent"
  | "gm_agent"
  | "building_agent"
  | "collections_agent";

export type ActorType =
  | "human"
  | "voice"
  | "resident_chat"
  | "driver"
  | "vendor"
  | "ai_agent"
  | "system";

export type AgentContext = {
  tenantId: string;
  sessionId?: string | null;
  conversationId?: string | null;
  agentType: AgentType;
  actorType: ActorType;
  actorId?: string | null;
  approvedByUserId?: string | null;
  trustedUiFlow?: boolean;
};

const agentToolAllowlist: Record<AgentType, Set<string>> = {
  resident_agent: new Set(["getResidentContextTool", "createLaundryOrderTool", "draftCustomerMessageTool"]),
  operator_voice_agent: new Set([
    "getResidentContextTool",
    "createPendingDryCleaningOrderTool",
    "updateOperatorAvailabilityTool",
    "createScheduleExceptionTool",
    "createDriverStopTool",
    "attachReceiptToOrderTool",
    "extractReceiptLineItemsTool",
    "completeDryCleaningIntakeTool",
    "draftCustomerMessageTool",
  ]),
  vendor_agent: new Set([
    "requestVendorConfirmationTool",
    "createVendorOnboardingSessionTool",
    "prefillVendorFromWebTool",
    "collectVendorDetailsTool",
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
    "createVendorPeerServiceRequestTool",
    "searchNetworkVendorsTool",
    "requestVendorBookingConfirmationTool",
    "expireVendorPeerServiceRequestTool",
    "exportVendorDataTool",
    "createVendorAdminCommandTool",
    "logVendorOnboardingAbandonmentTool",
    "scanAbandonedVendorOnboardingSessionsTool",
    "draftCustomerMessageTool",
  ]),
  driver_agent: new Set([
    "createDriverStopTool",
    "createDriverMissionTool",
    "updateOrderStatusTool",
    "getResidentContextTool",
  ]),
  gm_agent: new Set(["getLevel4GateStateTool", "getResidentContextTool", "draftCustomerMessageTool", "sendCustomerReminderTool", "logRevenueInterventionTool"]),
  building_agent: new Set(["getLevel4GateStateTool", "getResidentContextTool", "requestVendorConfirmationTool"]),
  collections_agent: new Set(["getLevel4GateStateTool", "getResidentContextTool", "draftCustomerMessageTool", "sendCustomerReminderTool", "logRevenueInterventionTool"]),
};

export function assertToolPermission(ctx: AgentContext, toolName: string): void {
  if (!agentToolAllowlist[ctx.agentType]?.has(toolName)) {
    throw new Error(`${ctx.agentType} is not allowed to run ${toolName}`);
  }
}

export function isTrustedOrderStateActor(ctx: AgentContext): boolean {
  return ctx.trustedUiFlow === true || ctx.actorType === "driver" || ctx.actorType === "human";
}
