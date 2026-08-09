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

export type OpenChannelTask = {
  id: string;
  position: number;
  title: string;
  detail: string;
  estimatedMinutes: number;
  category: OpenChannelTaskCategory;
  navigationQuery: string | null;
  status: "pending" | "completed";
  completedAt: string | null;
};

export type OpenChannelMission = {
  id: string;
  businessDate: string;
  status: "draft" | "active" | "completed";
  title: string;
  laraBriefing: string;
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
  "title" | "detail" | "estimatedMinutes" | "category" | "navigationQuery"
>;
