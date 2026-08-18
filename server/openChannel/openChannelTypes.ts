export const OPEN_CHANNEL_TASK_CATEGORIES = [
  "food",
  "sales",
  "operations",
  "personal",
  "finance",
  "travel",
  "other",
] as const;

export type OpenChannelTaskCategory =
  (typeof OPEN_CHANNEL_TASK_CATEGORIES)[number];

/**
 * §R1 Workstream 1. EXECUTION semantics — deliberately separate from the
 * topical `category` enum above. `base` completes at the desk/base (SEAL
 * THE WORK); `physical_stop` requires genuine physical arrival and resolves
 * through the expedition/Threshold flow ("RESOLVE THE STOP"), through the
 * exact same canonical `completeOpenChannelTask` write either way.
 *
 * The model proposes this at generation time; the operator's approval is
 * the only thing that persists it (see the approval UI in OpenChannel.tsx).
 * The DB column is nullable for legacy pre-R1 rows — the service-layer
 * projection (`missionProjection` in openChannelService.ts) is the ONE
 * place that resolves a null column to an effective value
 * (`row.execution ?? (row.navigationQuery ? "physical_stop" : "base")`),
 * so this type here — the shape every caller actually sees — is never null.
 */
export const OPEN_CHANNEL_TASK_EXECUTIONS = ["base", "physical_stop"] as const;

export type OpenChannelTaskExecution =
  (typeof OPEN_CHANNEL_TASK_EXECUTIONS)[number];

export type OpenChannelTask = {
  id: string;
  position: number;
  title: string;
  detail: string;
  estimatedMinutes: number;
  category: OpenChannelTaskCategory;
  navigationQuery: string | null;
  execution: OpenChannelTaskExecution;
  status: "pending" | "completed";
  completedAt: string | null;
};

/**
 * The single definition of the legacy-default rule (§R1 Workstream 1 item
 * 4): a stored row with a null `execution` column is a pre-R1 row, resolved
 * here — nowhere else — to an effective value. Pure and DB-shape-agnostic
 * (accepts anything with the two relevant fields) so it can be unit tested
 * without a database, and reused anywhere a raw row needs projecting.
 */
export function effectiveOpenChannelTaskExecution(row: {
  execution: OpenChannelTaskExecution | null;
  navigationQuery: string | null;
}): OpenChannelTaskExecution {
  return row.execution ?? (row.navigationQuery ? "physical_stop" : "base");
}

export type OpenChannelMission = {
  id: string;
  businessDate: string;
  status: "draft" | "active" | "completed";
  title: string;
  operatorBriefing: string;
  transcript: string;
  generationSource: "anthropic_structured" | "deterministic_fallback";
  gapStartedAt: string;
  nextCommitmentAt: string | null;
  availableMinutes: number | null;
  tasks: OpenChannelTask[];
  approvedAt: string | null;
  completedAt: string | null;
};

export type OpenChannelEditableTask = Pick<
  OpenChannelTask,
  | "title"
  | "detail"
  | "estimatedMinutes"
  | "category"
  | "navigationQuery"
  | "execution"
>;

export type GoldlineProgress = {
  businessDate: string;
  completedPickupCount: number;
  completedDeliveryCount: number;
  completedMissionStepCount: number;
  completedRouteActions: number;
  avatarSpace: number;
};
