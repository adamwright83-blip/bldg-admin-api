export type ActionType = "open_view" | "create_task" | "draft_sms" | "copy_summary";

export type ActionDef = {
  id: string;
  type: ActionType;
  label: string;
  route?: string;
  requiresApproval?: boolean;
};

/** Fixed catalog of actions the LLM may select by ID.
 *  The LLM picks IDs; the backend maps them to objects.
 *  No action executes automatically — UI renders deterministic buttons only. */
export const ACTION_CATALOG: Record<string, ActionDef> = {
  view_unpaid_orders: {
    id: "view_unpaid_orders",
    type: "open_view",
    label: "Show unpaid orders",
    route: "/intake",
  },
  open_intake_queue: {
    id: "open_intake_queue",
    type: "open_view",
    label: "Open intake queue",
    route: "/intake",
  },
  open_pickups: {
    id: "open_pickups",
    type: "open_view",
    label: "View pickups",
    route: "/pickups",
  },
  create_task: {
    id: "create_task",
    type: "create_task",
    label: "Create follow-up task",
    requiresApproval: true,
  },
  draft_sms: {
    id: "draft_sms",
    type: "draft_sms",
    label: "Draft SMS to lapsed customers",
    requiresApproval: true,
  },
  copy_summary: {
    id: "copy_summary",
    type: "copy_summary",
    label: "Copy summary",
  },
};

export const ACTION_IDS = Object.keys(ACTION_CATALOG);

export function getAction(id: string): ActionDef | undefined {
  return ACTION_CATALOG[id];
}

/** Map a list of LLM-supplied action IDs to their ActionDef objects.
 *  Silently drops any IDs not in the catalog (never throws). */
export function mapActionIds(ids: string[]): ActionDef[] {
  return ids.map((id) => ACTION_CATALOG[id]).filter((a): a is ActionDef => Boolean(a));
}
