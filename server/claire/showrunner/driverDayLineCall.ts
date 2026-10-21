/**
 * The Day Line a morning or evening Claire call speaks.
 *
 * Stops come from `buildDayPlanProjection`. The next-start filter is
 * `executableDayLineStops`. The field timeline is `getFieldToday`, the same
 * read as `trpc.system.field.today`. This module does not keep a list of its own.
 * It does not award points, coins, or streaks, and it does not place a call.
 */
import { dedupeSpokenTitles } from "../speech/dedupeSpokenTitles";
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
import { dedupeStopsByBuilding } from "../dayLine/buildingDedupe";
import { isTestFixtureTitle } from "../dayLine/testDataGuard";
import { mayRaiseOverdueSalesFollowUp } from "../dayLine/weekendQuietRule";

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
  /** Where the stop came from. Only self-generated sources (living world, commitments, sales) are collapsed by building. */
  source?: string;
  address?: string | null;
  physicalEntityId?: string | null;
  /** An overdue sales follow-up on a weekend: kept on the line, not volunteered on the call. */
  quietOnWeekend?: boolean;
};

export type DriverDayLineCallFacts = {
  read: "read" | "unread";
  businessDate: string;
  stops: DriverDayLineStopFact[];
  designatedMission: null | { id: string; title: string };
  fieldBlockers: Array<{ id: string; title: string; reason: string }>;
  pendingApproval: Array<{ id: string; title: string }>;
  omissions: string[];
  /** What was kept off the spoken line, so nothing silently disappears. */
  withheld?: { testData: number; duplicates: number; weekendFollowUps: number };
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
  /** The operator asked about sales follow-ups on this call, which lifts the weekend default. */
  operatorAskedAboutSales?: boolean;
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
  const raiseOverdue = mayRaiseOverdueSalesFollowUp({
    businessDate: input.businessDate,
    operatorAsked: input.operatorAskedAboutSales,
  });
  const overdueFollowUps = new Set(
    input.field.timeline
      .filter(item => item.kind === "follow_up" && item.urgency === "overdue")
      .map(item => `living-world-${item.id}`)
  );
  const mapped = projection.stops.map((stop): DriverDayLineStopFact => {
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
      source: stop.source,
      address: stop.address,
      physicalEntityId: stop.physicalEntityId ?? null,
      ...(overdueFollowUps.has(stop.id) && !raiseOverdue ? { quietOnWeekend: true } : {}),
    };
  });
  // Test fixtures never reach a call; self-generated duplicates (the same building twice) speak once.
  const real = mapped.filter(stop => !isTestFixtureTitle(stop.title));
  const stops = collapseSelfGeneratedDuplicates(real);
  const withheld = {
    testData: mapped.length - real.length,
    duplicates: real.length - stops.length,
    weekendFollowUps: stops.filter(stop => stop.quietOnWeekend).length,
  };
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
    withheld,
  };
}

const SELF_GENERATED_SOURCES = new Set(["living_world", "user_commitment", "commercial_mission"]);

/**
 * Orders are separate people at one address and are never merged. Sales follow-ups, commitments and the
 * living world can each describe the same building or the same task; those collapse to one stop.
 */
export function collapseSelfGeneratedDuplicates(stops: DriverDayLineStopFact[]): DriverDayLineStopFact[] {
  const eligible = stops.filter(stop => stop.source && SELF_GENERATED_SOURCES.has(stop.source));
  const kept = new Set(dedupeStopsByBuilding(eligible).map(stop => stop.id));
  return stops.filter(stop => !(stop.source && SELF_GENERATED_SOURCES.has(stop.source)) || kept.has(stop.id));
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
  const approvalTitles = (items: Array<{ title: string }>) => dedupeSpokenTitles(items.map(item => item.title));
  if (!line || line.read !== "read") {
    const approval = approvalTitles(line?.pendingApproval ?? []);
    return [
      "I couldn't read today's Day Line, so I won't guess what's on it.",
      approval.length ? `Still needs your approval: ${join(approval)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const spoken = collapseSelfGeneratedDuplicates(
    line.stops.filter(stop => !isTestFixtureTitle(stop.title) && !stop.quietOnWeekend)
  );
  // Two rows for one building are one thing to the operator; say it once.
  const titles = (stops: DriverDayLineStopFact[]) => dedupeSpokenTitles(stops.map(stop => stop.title));
  const executable = titles(spoken.filter(stop => stop.executable));
  const evidenced = titles(spoken.filter(stop => stop.completion === "completed_with_evidence"));
  const unmarked = titles(spoken.filter(stop => stop.completion === "completed_without_evidence"));
  const blocked = [
    ...titles(spoken.filter(stop => stop.completion === "blocked" || stop.completion === "deferred")),
    ...line.fieldBlockers.filter(item => !isTestFixtureTitle(item.title)).map(item => item.title),
  ];
  const approval = [
    ...titles(spoken.filter(stop => stop.needsApproval)),
    ...line.pendingApproval.filter(item => !isTestFixtureTitle(item.title)).map(item => item.title),
  ];
  // Spoken to a person: say what is true and useful, and leave out the empty
  // categories ("Nothing is waiting for your approval.") a report would list.
  const mission = line.designatedMission
    ? purpose === "evening_debrief"
      ? `Today's mission was ${line.designatedMission.title}.`
      : `Today's mission is ${line.designatedMission.title}.`
    : "";
  const omitted = [...new Set(line.omissions.map(label => OMISSION_LABELS[label] ?? label))];
  return [
    mission,
    executable.length
      ? purpose === "evening_debrief"
        ? `Still open: ${join(executable)}.`
        : `On today's line: ${join(executable)}.`
      : purpose === "evening_debrief"
        ? "Nothing was left open on today's line."
        : "Today's line is empty so far.",
    evidenced.length ? `Done and verified: ${join(evidenced)}.` : "",
    unmarked.length ? `Marked done, not yet verified: ${join(unmarked)}.` : "",
    blocked.length ? `Blocked or deferred: ${join(dedupeSpokenTitles(blocked))}.` : "",
    approval.length ? `Waiting on your approval: ${join(dedupeSpokenTitles(approval))}.` : "",
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
