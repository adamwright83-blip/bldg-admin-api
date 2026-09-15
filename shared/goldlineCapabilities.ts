export const GOLDLINE_CAPABILITY_STATUSES = [
  "SUPPORTED",
  "UNSUPPORTED",
  "CONDITIONALLY_SUPPORTED",
  "PENDING_IMPLEMENTATION",
] as const;

export type GoldlineCapabilityStatus = (typeof GOLDLINE_CAPABILITY_STATUSES)[number];

export const GOLDLINE_CAPABILITY_SURFACES = [
  "phone",
  "desktop",
  "mobile",
] as const;

export type GoldlineCapabilitySurface = (typeof GOLDLINE_CAPABILITY_SURFACES)[number];

export type GoldlineCapability = {
  id: string;
  domain: string;
  description: string;
  status: GoldlineCapabilityStatus;
  allowedSurfaces: GoldlineCapabilitySurface[];
  permissionLevel: "operator" | "admin" | "human_approval";
  implementation: string | null;
};

export const GOLDLINE_CAPABILITY_REGISTRY: GoldlineCapability[] = [
  {
    id: "dayline.create",
    domain: "dayline",
    description: "Add a Day Director commitment to the Daily Line",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "acceptDayDirectorCommitment",
  },
  {
    id: "dayline.update_details",
    domain: "dayline",
    description: "Update details or timing of an existing Day Director commitment",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "updateDayDirectorCommitment",
  },
  {
    id: "dayline.complete",
    domain: "dayline",
    description: "Mark an existing Day Director commitment complete",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "completeDayDirectorCommitment",
  },
  {
    id: "dayline.edit",
    domain: "dayline",
    description: "Change the action/display title of an existing Daily Line item without renaming the account",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "editDayLineItem",
  },
  {
    id: "dayline.cancel",
    domain: "dayline",
    description: "Soft-cancel active Daily Line work so it does not return on refresh, without erasing history",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "cancelDayLineItem",
  },
  {
    id: "commercial.visit_outcome.record",
    domain: "commercial",
    description: "Record an operator-attested commercial visit outcome",
    status: "SUPPORTED",
    allowedSurfaces: ["phone", "desktop", "mobile"],
    permissionLevel: "operator",
    implementation: "recordCommercialMissionVisitOutcome",
  },
];

export function getGoldlineCapability(id: string): GoldlineCapability | undefined {
  return GOLDLINE_CAPABILITY_REGISTRY.find(item => item.id === id);
}

export function capabilityIsActionable(id: string): boolean {
  const capability = getGoldlineCapability(id);
  return capability?.status === "SUPPORTED" || capability?.status === "CONDITIONALLY_SUPPORTED";
}

export function formatCapabilityBriefing(
  capabilities: readonly GoldlineCapability[] = GOLDLINE_CAPABILITY_REGISTRY
): string {
  const supported = capabilities.filter(item => item.status === "SUPPORTED").map(item => item.id);
  const unsupported = capabilities
    .filter(item => item.status === "UNSUPPORTED" || item.status === "PENDING_IMPLEMENTATION")
    .map(item => item.id);
  return [
    `Supported Goldline capabilities: ${supported.join(", ") || "none"}.`,
    unsupported.length
      ? `Not yet supported: ${unsupported.join(", ")}. If the operator asks for one of these, say so plainly and offer to send it to engineering. Do not pretend it happened.`
      : "",
    "The registry is authoritative. Do not invent an action Goldline cannot perform.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const CAPABILITY_GAP_STATUSES = [
  "IDENTIFIED",
  "APPROVED_FOR_ENGINEERING",
  "ENGINEERING_RUNNING",
  "NEEDS_HUMAN",
  "PR_READY",
  "IMPLEMENTED_NO_PR",
  "ALREADY_SUPPORTED",
  "BLOCKED",
  "CLOSED",
] as const;

export type CapabilityGapStatus = (typeof CAPABILITY_GAP_STATUSES)[number];

export const ENGINEERING_TERMINAL_STATUSES = [
  "PR_READY",
  "IMPLEMENTED_NO_PR",
  "ALREADY_SUPPORTED",
  "NEEDS_HUMAN",
  "BLOCKED",
] as const;

export type EngineeringTerminalStatus = (typeof ENGINEERING_TERMINAL_STATUSES)[number];

export const ENGINEERING_PROGRESS_STATUSES = ["BLOCKED"] as const;

export type CapabilityGapRecord = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  capabilityKey: string;
  operatorRequest: string;
  conversationSessionId: string | null;
  status: CapabilityGapStatus;
  engineeringSessionId: string | null;
  engineeringStatus: string | null;
  terminalResultJson: Record<string, unknown> | null;
  branch: string | null;
  prUrl: string | null;
  blocker: string | null;
  requiresHumanApproval: boolean;
  createdAt: string;
  updatedAt: string;
};
