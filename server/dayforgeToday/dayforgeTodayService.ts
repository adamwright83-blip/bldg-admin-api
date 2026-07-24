import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialFollowUps,
  commercialMissionDispatches,
  commercialMissions,
  commercialPipelineRecords,
} from "../../drizzle/schema";
import { getDb } from "../db";

export type DayforgeTodayItem = {
  id: string;
  kind: "follow_up" | "dispatch" | "missing_next_action";
  urgency: "overdue" | "urgent" | "today" | "upcoming" | "exception";
  missionId: number;
  pipelineId: number | null;
  followUpId: string | null;
  accountName: string;
  missionCode: string;
  status: string;
  dueAt: string | null;
  note: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  destinationPath: string;
  estimatedValueCents: number | null;
};

const TERMINAL_STAGES = ["won", "lost"] as const;

export function sortDayforgeTodayItems(
  items: DayforgeTodayItem[],
  now = new Date()
): DayforgeTodayItem[] {
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const urgencyRank = (item: DayforgeTodayItem) => {
    if (item.dueAt && Date.parse(item.dueAt) < now.getTime()) return 0;
    if (item.kind === "dispatch") return 1;
    if (item.dueAt && Date.parse(item.dueAt) <= dayEnd.getTime()) return 2;
    if (item.dueAt) return 3;
    return 4;
  };
  return [...items].sort((left, right) => {
    const rank = urgencyRank(left) - urgencyRank(right);
    if (rank) return rank;
    const due = (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER)
      - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER);
    if (due) return due;
    const value = (right.estimatedValueCents ?? -1) - (left.estimatedValueCents ?? -1);
    return value || left.id.localeCompare(right.id);
  });
}

export async function listDayforgeToday(input: {
  tenantId: string;
  userId: string;
  includeAllAssignees?: boolean;
}): Promise<DayforgeTodayItem[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const pipelines = await db
    .select({
      pipelineId: commercialPipelineRecords.id,
      stage: commercialPipelineRecords.stage,
      missionId: commercialMissions.id,
      missionCode: commercialMissions.code,
      missionStatus: commercialMissions.status,
      assignedTo: commercialMissions.assignedTo,
      estimatedValueCents: commercialPipelineRecords.estimatedContractValueCents,
      accountId: commercialAccounts.id,
      accountName: commercialAccounts.name,
    })
    .from(commercialPipelineRecords)
    .innerJoin(commercialMissions, and(
      eq(commercialMissions.tenantId, input.tenantId),
      eq(commercialMissions.id, commercialPipelineRecords.missionId)
    ))
    .innerJoin(commercialAccounts, and(
      eq(commercialAccounts.tenantId, input.tenantId),
      eq(commercialAccounts.id, commercialPipelineRecords.accountId)
    ))
    .where(and(
      eq(commercialPipelineRecords.tenantId, input.tenantId),
      notInArray(commercialPipelineRecords.stage, [...TERMINAL_STAGES])
    ));
  const visible = pipelines.filter(row =>
    input.includeAllAssignees || row.assignedTo === null || row.assignedTo === input.userId
  );
  if (!visible.length) return [];
  const pipelineIds = visible.map(row => row.pipelineId);
  const missionIds = visible.map(row => row.missionId);
  const accountIds = visible.map(row => row.accountId);
  const [followUps, dispatches, locations, contacts] = await Promise.all([
    db.select().from(commercialFollowUps).where(and(
      eq(commercialFollowUps.tenantId, input.tenantId),
      eq(commercialFollowUps.status, "open"),
      inArray(commercialFollowUps.pipelineId, pipelineIds)
    )).orderBy(asc(commercialFollowUps.dueAt)),
    db.select().from(commercialMissionDispatches).where(and(
      eq(commercialMissionDispatches.tenantId, input.tenantId),
      inArray(commercialMissionDispatches.missionId, missionIds),
      inArray(commercialMissionDispatches.status, ["queued", "sent"])
    )),
    db.select().from(commercialAccountLocations).where(and(
      eq(commercialAccountLocations.tenantId, input.tenantId),
      inArray(commercialAccountLocations.accountId, accountIds)
    )),
    db.select().from(commercialAccountContacts).where(and(
      eq(commercialAccountContacts.tenantId, input.tenantId),
      inArray(commercialAccountContacts.accountId, accountIds)
    )),
  ]);
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const items: DayforgeTodayItem[] = [];
  for (const row of visible) {
    const location = locations.find(item => item.accountId === row.accountId && item.isPrimary)
      ?? locations.find(item => item.accountId === row.accountId);
    const contact = contacts.find(item => item.accountId === row.accountId && item.email)
      ?? contacts.find(item => item.accountId === row.accountId);
    const base = {
      missionId: row.missionId,
      pipelineId: row.pipelineId,
      accountName: row.accountName,
      missionCode: row.missionCode,
      status: row.missionStatus,
      address: location?.address ?? null,
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      estimatedValueCents: row.estimatedValueCents,
    };
    const rowFollowUps = followUps.filter(item => item.pipelineId === row.pipelineId);
    for (const followUp of rowFollowUps) {
      const dueAt = followUp.dueAt.toISOString();
      items.push({
        ...base,
        id: `follow-up:${followUp.id}`,
        kind: "follow_up",
        urgency: followUp.dueAt < now ? "overdue" : followUp.dueAt <= end ? "today" : "upcoming",
        followUpId: followUp.id,
        dueAt,
        note: followUp.note,
        destinationPath: `/commercial-pipeline?pipeline=${row.pipelineId}`,
      });
    }
    const rowDispatches = dispatches.filter(item => item.missionId === row.missionId);
    for (const dispatch of rowDispatches) items.push({
      ...base,
      id: `dispatch:${dispatch.id}`,
      kind: "dispatch",
      urgency: "urgent",
      followUpId: null,
      dueAt: null,
      note: "Open your assigned field mission",
      destinationPath: dispatch.destinationPath,
    });
    const activeStep = ["preparing", "en_route", "arrived"].includes(row.missionStatus);
    if (!rowFollowUps.length && !rowDispatches.length && !activeStep) items.push({
      ...base,
      id: `missing:${row.missionId}`,
      kind: "missing_next_action",
      urgency: "exception",
      followUpId: null,
      dueAt: null,
      note: "No next action is scheduled. Fix this lead now.",
      destinationPath: `/commercial-missions?mission=${row.missionId}`,
    });
  }
  return sortDayforgeTodayItems(items, now);
}
