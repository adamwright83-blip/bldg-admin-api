import type { ResidentAgentPlan, ResidentCoordinatedRequest, ServiceRequest } from "../../drizzle/schema";
import {
  adaptResidentAgentPlanToJobCards,
  adaptResidentCoordinatedRequestToJobCard,
  adaptServiceRequestToJobCard,
  type ExistingRequestJobCardAdapterResult,
  type JoinedResidentContext,
} from "./existingRequestJobCardAdapter";

export const REQUEST_JOB_CARD_SOURCE_TYPES = [
  "service_request", "resident_coordinated_request", "resident_agent_plan",
] as const;
export type RequestJobCardSourceType = (typeof REQUEST_JOB_CARD_SOURCE_TYPES)[number];

export type ServiceRequestJobCardSource = {
  record: Pick<ServiceRequest,
    "id" | "bldgUserId" | "serviceType" | "status" | "requestSummary" | "requestJson"
    | "scheduledDate" | "scheduledWindow" | "createdAt">;
  residentContext: JoinedResidentContext;
};

export type RequestJobCardSourceRecords = {
  serviceRequests: ServiceRequestJobCardSource[];
  coordinatedRequests: Array<Pick<ResidentCoordinatedRequest,
    "id" | "bldgUserId" | "residentName" | "buildingSlug" | "unit" | "serviceCategory"
    | "serviceRequested" | "requestedDate" | "requestedWindow" | "deadlineDate" | "deadlineReason"
    | "origin" | "destination" | "notes" | "status" | "sourceConversationId" | "sourceSessionId"
    | "parentPlanId" | "rawJson" | "createdAt">>;
  residentPlans: Array<Pick<ResidentAgentPlan,
    "id" | "bldgUserId" | "residentName" | "buildingSlug" | "unit" | "conversationId"
    | "sessionId" | "originalMessage" | "planStatus" | "planJson" | "createdAt">>;
};

export type RequestJobCardReadItem = ExistingRequestJobCardAdapterResult & {
  createdAt: string;
};

export type RequestJobCardPage = {
  items: RequestJobCardReadItem[];
  page: {
    limit: number;
    offset: number;
    returnedSourceRecords: number;
    returnedJobCards: number;
    hasMore: boolean;
  };
  diagnostics: {
    sourceRecordsWithoutCards: number;
  };
};

type Candidate = { createdAt: Date; stableKey: string; adapted: ExistingRequestJobCardAdapterResult };

function validDate(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

/**
 * Derives a stable, paginated administrative read model from already-fetched
 * source records. Pagination is over source records; a multi-intent plan may
 * contain several job cards. Raw source JSON is never returned directly.
 */
export function buildRequestJobCardPage(input: {
  sources: RequestJobCardSourceRecords;
  limit: number;
  offset: number;
}): RequestJobCardPage {
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
  const offset = Math.max(0, Math.min(1000, Math.trunc(input.offset)));
  const candidates: Candidate[] = [
    ...input.sources.serviceRequests.map(source => ({
      createdAt: validDate(source.record.createdAt),
      stableKey: `service_request:${source.record.id}`,
      adapted: adaptServiceRequestToJobCard(source),
    })),
    ...input.sources.coordinatedRequests.map(record => ({
      createdAt: validDate(record.createdAt),
      stableKey: `resident_coordinated_request:${record.id}`,
      adapted: adaptResidentCoordinatedRequestToJobCard({ record }),
    })),
    ...input.sources.residentPlans.map(record => ({
      createdAt: validDate(record.createdAt),
      stableKey: `resident_agent_plan:${record.id}`,
      adapted: adaptResidentAgentPlanToJobCards({ record }),
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.stableKey.localeCompare(b.stableKey));

  const selected = candidates.slice(offset, offset + limit);
  const items = selected.map(candidate => ({
    ...candidate.adapted,
    createdAt: candidate.createdAt.toISOString(),
  }));
  return {
    items,
    page: {
      limit, offset, returnedSourceRecords: items.length,
      returnedJobCards: items.reduce((total, item) => total + item.jobCards.length, 0),
      hasMore: candidates.length > offset + limit,
    },
    diagnostics: {
      sourceRecordsWithoutCards: items.filter(item => item.jobCards.length === 0).length,
    },
  };
}
