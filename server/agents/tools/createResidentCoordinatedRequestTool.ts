import { createResidentCoordinatedRequest } from "../../db";
import type { AgentTool } from "../toolRegistry";

type ServiceCategory =
  | "dog_grooming"
  | "car_detail"
  | "airport_transport"
  | "apartment_cleaning"
  | "dry_cleaning"
  | "other";

type CoordinatedRequestStatus =
  | "pending_operator_review"
  | "pending_provider_confirmation"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed"
  | "failed";

type InitialCoordinatedRequestStatus = "pending_operator_review" | "pending_provider_confirmation";

const allowedServiceCategories = new Set<ServiceCategory>([
  "dog_grooming",
  "car_detail",
  "airport_transport",
  "apartment_cleaning",
  "dry_cleaning",
  "other",
]);

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function requireServiceCategory(value: unknown): ServiceCategory {
  if (allowedServiceCategories.has(value as ServiceCategory)) {
    return value as ServiceCategory;
  }
  throw new Error("serviceCategory is invalid");
}

function defaultStatus(input: Record<string, any>): InitialCoordinatedRequestStatus {
  return input.providerVendorId != null ? "pending_provider_confirmation" : "pending_operator_review";
}

export const createResidentCoordinatedRequestTool: AgentTool<Record<string, any>, {
  requestId: number;
  parentPlanId: number | null;
  status: CoordinatedRequestStatus;
  serviceCategory: ServiceCategory;
  serviceRequested: string;
  requiresProviderConfirmation: true;
  customerCharged: false;
  residentVisibleStatus: CoordinatedRequestStatus;
  message: string;
}> = {
  name: "createResidentCoordinatedRequestTool",
  description: "Create resident-safe operational work for non-laundry services that need operator or provider confirmation.",
  async execute(input, ctx) {
    const serviceCategory = requireServiceCategory(input.serviceCategory);
    const serviceRequested = nullableString(input.serviceRequested);
    if (!serviceRequested) {
      throw new Error("serviceRequested is required");
    }

    const status = defaultStatus(input);
    const parentPlanId = nullableNumber(input.parentPlanId);
    const requestId = await createResidentCoordinatedRequest({
      tenantId: ctx.tenantId,
      bldgUserId: nullableNumber(input.bldgUserId),
      residentName: nullableString(input.residentName),
      residentPhone: nullableString(input.residentPhone),
      residentEmail: nullableString(input.residentEmail),
      buildingSlug: nullableString(input.buildingSlug),
      buildingName: nullableString(input.buildingName),
      unit: nullableString(input.unit),
      serviceCategory,
      serviceRequested,
      requestedDate: nullableString(input.requestedDate),
      requestedWindow: nullableString(input.requestedWindow),
      deadlineDate: nullableString(input.deadlineDate),
      deadlineReason: nullableString(input.deadlineReason),
      origin: nullableString(input.origin),
      destination: nullableString(input.destination),
      notes: nullableString(input.notes),
      status,
      statusReason: "Created by resident agent; awaiting human/provider confirmation.",
      residentVisibleStatus: status,
      nextAction: status === "pending_provider_confirmation"
        ? "Provider confirmation required before resident can treat this as booked."
        : "Operator review required before provider confirmation.",
      requiresHumanApproval: true,
      customerCharged: false,
      providerVendorId: nullableNumber(input.providerVendorId),
      providerConfirmationStatus: null,
      sourceConversationId: nullableString(input.sourceConversationId) ?? ctx.conversationId ?? null,
      sourceSessionId: nullableString(input.sourceSessionId) ?? ctx.sessionId ?? null,
      parentPlanId,
      rawJson: {
        input,
        actorId: ctx.actorId ?? null,
        agentType: ctx.agentType,
        actorType: ctx.actorType,
      },
    });

    return {
      entityType: "resident_coordinated_request",
      entityId: requestId,
      output: {
        requestId,
        parentPlanId,
        status,
        serviceCategory,
        serviceRequested,
        requiresProviderConfirmation: true,
        customerCharged: false,
        residentVisibleStatus: status,
        message: "Request created for operator/provider confirmation. The resident has not been charged and the service is not confirmed yet.",
      },
    };
  },
};
