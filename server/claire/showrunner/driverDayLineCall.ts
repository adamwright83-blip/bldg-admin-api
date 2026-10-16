/**
 * The Day Line a morning or evening Claire call speaks.
 *
 * Stops come from `buildDayPlanProjection`. The next-start filter is
 * `executableDayLineStops`. The field timeline is `getFieldToday`, the same
 * read as `trpc.system.field.today`. This module does not keep a list of its own.
 * It does not award points, coins, or streaks, and it does not place a call.
 */
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type { DayDirectorCommitment, ProcessingLocation } from "@shared/dayDirector";
import type { MissionPlanOutcome } from "@shared/missionDirector";
import {
  buildDayPlanProjection,
  executableDayLineStops,
  liveObjectivesFromFieldToday,
  type DayPlanStop,
} from "../../../client/src/pages/driver/goldlineDayPlanModel";
import { getFieldToday } from "../../field/fieldTodayService";
import type { FieldTodayProjection } from "../../field/types";
import { listDriverOrdersByDateForMember } from "../../domains/orders/driver/driverOrderService";
import { listExternalOrders } from "../../externalOrders/externalOrderService";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { operatorDesignatedMission } from "../../planning/dayline/currentDayLineService";
import { getLatestPlan } from "../../planning/missionDirector/missionDirectorService";
import { listDriverBuiltMissions } from "../../commercialMissions/commercialMissionBuilderService";
import { readCurrentOpenChannelMission } from "../../openChannel/openChannelService";
import type { OpenChannelMission } from "../../openChannel/openChannelTypes";

const APPROVAL_STATUSES = new Set([
  "draft",
  "draft_pending_review",
  "pending_review",
  "pending_approval",
]);

const OMISSION_LABELS: Record<string, string> = {
  orders: "pickup and delivery orders",
  external_orders: "external jobs",
  sales_missions: "sales missions",
  commitments: "commitments",
  open_channel: "the open briefing",
  mission_plan: "the stored mission plan",
};

export type DriverDayLineStopFact = {
  id: string;
  title: string;
  status: DayPlanStop["status"];
  timeLabel: string;
  executable: boolean;
  completion:
    | "unfinished"
    | "completed_with_evidence"
    | "completed_without_evidence"
    | "blocked"
    | "deferred"
    | "cancelled";
  needsApproval: boolean;
  evidence: string | null;
};

export type DriverDayLineCallFacts = {
  read: "read" | "unread";
  businessDate: string;
  stops: DriverDayLineStopFact[];
  designatedMission: null | { id: string; title: string };
  fieldBlockers: Array<{ id: string; title: string; reason: string }>;
  pendingApproval: Array<{ id: string; title: string }>;
  omissions: string[];
};

export type DriverDayLineCaller = {
  tenantId: string;
  userId: string;
  includeAllAssignees: boolean;
  dayDirectorActorId: string;
  dayDirectorActorIds: string[];
  canonicalOperatorId: string;
};

export type DriverDayLineProjectionInput = {
  businessDate: string;
  now: Date;
  field: FieldTodayProjection;
  pickups?: Order[];
  deliveries?: Order[];
  externalOrders?: ExternalOperationalOrder[];
  commitments?: DayDirectorCommitment[];
  salesMissions?: CommercialMission[];
  openChannelMission?: OpenChannelMission | null;
  processingLocation?: ProcessingLocation | null;
  missionPlan?: MissionPlanOutcome | null;
  pendingApproval?: Array<{ id: string; title: string }>;
  omissions?: string[];
};

const join = (values: string[]) =>
  values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;

export function unreadDriverDayLine(businessDate: string): DriverDayLineCallFacts {
  return {
    read: "unread",
    businessDate,
    stops: [],
    designatedMission: null,
    fieldBlockers: [],
    pendingApproval: [],
    omissions: ["field_today"],
  };
}

function evidenceFor(stop: DayPlanStop, evidenceIds: ReadonlySet<string>): string | null {
  const keys = [stop.id];
  if (stop.id.startsWith("living-world-")) keys.push(stop.id.slice("living-world-".length));
  if (stop.id.startsWith("native-pickup-")) keys.push(`pickup:${stop.id.slice("native-pickup-".length)}`);
  if (stop.id.startsWith("native-dropoff-")) keys.push(`delivery:${stop.id.slice("native-dropoff-".length)}`);
  const matched = keys.find(key => evidenceIds.has(key));
  if (matched) return matched;
  if (stop.source === "living_world") return null;
  if (stop.status === "completed" && stop.completedAt) return stop.completedAt;
  return null;
}

function completionFor(
  stop: DayPlanStop,
  evidence: string | null
): DriverDayLineStopFact["completion"] {
  const deferred = stop.timeLabel.startsWith("Deferred");
  if (stop.status === "cancelled") return "cancelled";
  if (stop.status === "blocked") return deferred ? "deferred" : "blocked";
  if (deferred) return "deferred";
  if (stop.status === "completed") {
    return evidence ? "completed_with_evidence" : "completed_without_evidence";
  }
  return "unfinished";
}

/** One projection, then the driver's start filter. No extra stop is created here. */
export function projectDriverDayLineForCall(
  input: DriverDayLineProjectionInput
): DriverDayLineCallFacts {
  const projection = buildDayPlanProjection({
    businessDate: input.businessDate,
    pickups: input.pickups,
    deliveries: input.deliveries,
    externalOrders: input.externalOrders,
    openChannelMission: input.openChannelMission,
    salesMissions: input.salesMissions,
    now: input.now,
    nextCommitmentAt: input.field.nextFixedCommitment?.scheduledAt ?? null,
    processingLocation: input.processingLocation,
    commitments: input.commitments,
    liveObjectives: liveObjectivesFromFieldToday(input.field.timeline),
    missionPlan: input.missionPlan,
  });
  const executable = new Set(executableDayLineStops(projection.stops).map(stop => stop.id));
  const evidenceIds = new Set(input.field.authoritativeCompletedObjectiveIds);
  const approvalByStop = new Map<string, boolean>();
  for (const item of input.field.timeline) {
    approvalByStop.set(`living-world-${item.id}`, APPROVAL_STATUSES.has(item.status));
  }
  const stops = projection.stops.map((stop): DriverDayLineStopFact => {
    const evidence = evidenceFor(stop, evidenceIds);
    return {
      id: stop.id,
      title: stop.title,
      status: stop.status,
      timeLabel: stop.timeLabel,
      executable: executable.has(stop.id),
      completion: completionFor(stop, evidence),
      needsApproval: approvalByStop.get(stop.id) ?? false,
      evidence,
    };
  });
  const stopIds = new Set(stops.map(stop => stop.id));
  const fieldBlockers = input.field.blockers
    .filter(item => !stopIds.has(item.id) && !stopIds.has(`living-world-${item.id}`))
    .map(item => ({ id: item.id, title: item.title, reason: item.subtitle }));
  const pendingApproval = [...(input.pendingApproval ?? [])];
  if (input.openChannelMission?.status === "draft") {
    pendingApproval.push({
      id: input.openChannelMission.id,
      title: input.openChannelMission.title,
    });
  }
  return {
    read: "read",
    businessDate: input.businessDate,
    stops,
    designatedMission: operatorDesignatedMission(
      input.commitments ?? [],
      input.missionPlan ?? undefined
    ),
    fieldBlockers,
    pendingApproval,
    omissions: input.omissions ?? [],
  };
}

function missingTable(error: unknown): boolean {
  const cause = error instanceof Error && "cause" in error ? String(error.cause) : "";
  const text = `${error instanceof Error ? error.message : String(error)} ${cause}`;
  return /ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(text);
}

async function readOr<T>(
  label: string,
  omissions: string[],
  fallback: T,
  read: () => Promise<T>,
  quietWhenMissing = false
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (quietWhenMissing && missingTable(error)) return fallback;
    omissions.push(label);
    return fallback;
  }
}

export async function loadDriverDayLineForCall(input: {
  caller: DriverDayLineCaller;
  businessDate: string;
  now: Date;
  timeZone: string;
  pendingApproval?: Array<{ id: string; title: string }>;
  getField?: typeof getFieldToday;
  listOrders?: typeof listDriverOrdersByDateForMember;
  listExternal?: typeof listExternalOrders;
  getDay?: typeof getDayDirectorState;
  getPlan?: typeof getLatestPlan;
  listSales?: typeof listDriverBuiltMissions;
  readOpenChannel?: typeof readCurrentOpenChannelMission;
}): Promise<DriverDayLineCallFacts> {
  const getField = input.getField ?? getFieldToday;
  let field: FieldTodayProjection;
  try {
    field = await getField({
      tenantId: input.caller.tenantId,
      userId: input.caller.userId,
      includeAllAssignees: input.caller.includeAllAssignees,
      now: input.now,
      timeZone: input.timeZone,
      businessDate: input.businessDate,
    });
  } catch {
    const unread = unreadDriverDayLine(input.businessDate);
    unread.pendingApproval = input.pendingApproval ?? [];
    return unread;
  }
  const omissions: string[] = [];
  const listOrders = input.listOrders ?? listDriverOrdersByDateForMember;
  const listExternal = input.listExternal ?? listExternalOrders;
  const getDay = input.getDay ?? getDayDirectorState;
  const getPlan = input.getPlan ?? getLatestPlan;
  const listSales = input.listSales ?? listDriverBuiltMissions;
  const readOpenChannel = input.readOpenChannel ?? readCurrentOpenChannelMission;
  const orderQuery = async (
    status: "new" | "collected" | "ready" | "delivered",
    dateField: "pickupDate" | "deliveryDate"
  ) =>
    listOrders({
      tenantId: input.caller.tenantId,
      status,
      date: input.businessDate,
      dateField,
    });
  let pickups: Order[] = [];
  let deliveries: Order[] = [];
  try {
    const [fresh, collected, ready, delivered] = await Promise.all([
      orderQuery("new", "pickupDate"),
      orderQuery("collected", "pickupDate"),
      orderQuery("ready", "deliveryDate"),
      orderQuery("delivered", "deliveryDate"),
    ]);
    pickups = [...collected, ...fresh] as Order[];
    deliveries = [...delivered, ...ready] as Order[];
  } catch {
    omissions.push("orders");
  }
  const [externalOrders, day, plan, salesMissions, openChannelMission] = await Promise.all([
    readOr("external_orders", omissions, [] as ExternalOperationalOrder[], () =>
      listExternal({ tenantId: input.caller.tenantId, scheduledDate: input.businessDate })
    ),
    readOr("commitments", omissions, null, () =>
      getDay({
        tenantId: input.caller.tenantId,
        actorId: input.caller.dayDirectorActorId,
        actorIds: input.caller.dayDirectorActorIds,
        canonicalOperatorId: input.caller.canonicalOperatorId,
        businessDate: input.businessDate,
      })
    ),
    readOr("mission_plan", omissions, null, () =>
      getPlan({
        tenantId: input.caller.tenantId,
        operatorId: input.caller.dayDirectorActorId,
        operatorIds: input.caller.dayDirectorActorIds,
        businessDate: input.businessDate,
      })
    ),
    readOr("sales_missions", omissions, [] as CommercialMission[], () =>
      listSales({ tenantId: input.caller.tenantId, driverId: input.caller.userId })
    ),
    readOr(
      "open_channel",
      omissions,
      null as OpenChannelMission | null,
      () =>
        readOpenChannel({
          tenantId: input.caller.tenantId,
          driverId: input.caller.userId,
          businessDate: input.businessDate,
        }),
      true
    ),
  ]);
  return projectDriverDayLineForCall({
    businessDate: input.businessDate,
    now: input.now,
    field,
    pickups,
    deliveries,
    externalOrders,
    commitments: day?.commitments,
    salesMissions,
    openChannelMission,
    processingLocation: day?.processingLocation ?? null,
    missionPlan: plan?.outcome,
    pendingApproval: input.pendingApproval,
    omissions,
  });
}

export function speakDriverDayLineCall(
  line: DriverDayLineCallFacts | null | undefined,
  purpose: "morning_readiness" | "evening_debrief"
): string {
  const approvalTitles = (items: Array<{ title: string }>) => [...new Set(items.map(item => item.title))];
  if (!line || line.read !== "read") {
    const approval = approvalTitles(line?.pendingApproval ?? []);
    return [
      "I couldn't read today's Day Line, so I won't guess what's on it.",
      approval.length ? `Still needs your approval: ${join(approval)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const titles = (stops: DriverDayLineStopFact[]) => [...new Set(stops.map(stop => stop.title))];
  const executable = titles(line.stops.filter(stop => stop.executable));
  const evidenced = titles(line.stops.filter(stop => stop.completion === "completed_with_evidence"));
  const unmarked = titles(line.stops.filter(stop => stop.completion === "completed_without_evidence"));
  const blocked = [
    ...titles(line.stops.filter(stop => stop.completion === "blocked" || stop.completion === "deferred")),
    ...line.fieldBlockers.map(item => item.title),
  ];
  const approval = [
    ...titles(line.stops.filter(stop => stop.needsApproval)),
    ...line.pendingApproval.map(item => item.title),
  ];
  const mission = line.designatedMission
    ? purpose === "evening_debrief"
      ? `Today's designated mission was ${line.designatedMission.title}.`
      : `Today's designated mission is ${line.designatedMission.title}.`
    : purpose === "evening_debrief"
      ? "No designated mission was stored for today."
      : "No designated mission is stored for today.";
  const omitted = [...new Set(line.omissions.map(label => OMISSION_LABELS[label] ?? label))];
  return [
    mission,
    executable.length
      ? `Unfinished on the Day Line: ${join(executable)}.`
      : "Nothing unfinished is on the Day Line.",
    evidenced.length
      ? `Completed with execution evidence: ${join(evidenced)}.`
      : "No stop has execution evidence of completion.",
    unmarked.length ? `Marked completed without execution evidence: ${join(unmarked)}.` : "",
    blocked.length
      ? `Blocked or deferred: ${join([...new Set(blocked)])}.`
      : "Nothing on the line is blocked or deferred.",
    approval.length
      ? `Still needs your approval: ${join([...new Set(approval)])}.`
      : "Nothing is waiting for your approval.",
    omitted.length
      ? `I could not read ${join(omitted)}, so this is not the full Day Line.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function driverDayLineStopIds(line: DriverDayLineCallFacts | null | undefined): string[] {
  return line?.stops.map(stop => stop.id) ?? [];
}
