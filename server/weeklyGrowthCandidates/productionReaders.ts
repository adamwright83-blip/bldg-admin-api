import { formatInTimeZone } from "date-fns-tz";
import { and, eq } from "drizzle-orm";
import { commercialFollowUps, dayDirectorCommitments } from "../../drizzle/schema";
import type { GrowthCampaign, TimingAssumption } from "../campaignLibrary/campaignLibraryTypes";
import { listCampaigns } from "../campaignLibrary/campaignLibraryService";
import { listOperatorRuns } from "../campaignRuns/campaignRunService";
import { getLatestChurnScan } from "../churnRadar/customerChurnService";
import { getActiveMacroGoal } from "../claire/macroGoalService";
import { loadObligations } from "../claire/proactive/boardService";
import { listCommercialMissions } from "../commercialMissions/commercialMissionStore";
import { getDb } from "../db";
import { listOpsTasks, type OpsTaskType } from "../opsTasks";
import { asRecord, dayLineDisplayTitle, readDayLineOverlay } from "../../shared/goldlineDayLine";
import type { ProactiveObligation } from "../../shared/claireProactive";
import type { WeeklyGrowthMotion, WeeklyGrowthPocketKind } from "../../shared/weeklyGrowthCandidates";
import {
  emptyRawRecord,
  type SourceAvailability,
  type WeeklyGrowthGrounding,
  type WeeklyGrowthMacroSnapshot,
  type WeeklyGrowthOperationalClass,
  type WeeklyGrowthRawRecord,
  type WeeklyGrowthSourceBundle,
} from "./rawRecord";

const DATABASE_UNAVAILABLE = "database_unavailable";

const GROWTH_OPS: Partial<Record<OpsTaskType, { grounding: WeeklyGrowthGrounding; motion: WeeklyGrowthMotion }>> = {
  referral_ask: { grounding: "sales", motion: "relationship_capital" },
  stale_customer: { grounding: "proactive_recovery", motion: "customer_recovery" },
  door_hanger_operation: { grounding: "campaign_linked", motion: "territory_expansion" },
  office_account_pitch: { grounding: "sales", motion: "account_acquisition" },
  review_request: { grounding: "growth_tagged", motion: "reputation" },
  digital_footprint_post: { grounding: "growth_tagged", motion: "digital_presence" },
  partnership_outreach: { grounding: "sales", motion: "alliance" },
  gm_followup: { grounding: "commercial_follow_up", motion: "commercial_follow_up" },
};

const OPERATIONAL_OPS: Partial<Record<OpsTaskType, WeeklyGrowthOperationalClass>> = {
  missed_pickup: "pickup",
  intake_missing_price: "laundry_processing",
  unpaid_order: "admin",
  vague_intake: "admin",
  dry_clean_receipt_intake: "laundry_processing",
  revenue_leak: "admin",
  vendor_followup: "procurement",
  emergency_task: "admin",
};

export async function readWeeklyGrowthSources(input: {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  timeZone: string;
}): Promise<WeeklyGrowthSourceBundle> {
  const db = await getDb();
  if (!db) return unavailableBundle(DATABASE_UNAVAILABLE);
  const [unfinished, commercialFollowUpsSource, proactiveObligations, recovery, campaigns, macroGoal] = await Promise.all([
    readUnfinished(input).catch(unavailable),
    readFollowUps(input).catch(unavailable),
    readObligations(input).catch(unavailable),
    readRecovery(input).catch(unavailable),
    readCampaigns(input).catch(unavailable),
    readMacro(input).catch(unavailableMacro),
  ]);
  return { unfinished, commercialFollowUps: commercialFollowUpsSource, proactiveObligations, recovery, campaigns, macroGoal };
}

async function readUnfinished(input: {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
}): Promise<SourceAvailability<WeeklyGrowthRawRecord>> {
  const [commitments, missions, tasks, runs] = await Promise.all([
    readCommitments(input),
    readMissions(input),
    readTasks(input),
    readRuns(input),
  ]);
  return { status: "available", records: [...commitments, ...missions, ...tasks, ...runs] };
}

async function readCommitments(input: {
  tenantId: string;
  dayDirectorActorId: string;
}): Promise<WeeklyGrowthRawRecord[]> {
  const db = await getDb();
  if (!db) throw new Error(DATABASE_UNAVAILABLE);
  const rows = await db
    .select()
    .from(dayDirectorCommitments)
    .where(and(eq(dayDirectorCommitments.tenantId, input.tenantId), eq(dayDirectorCommitments.actorId, input.dayDirectorActorId)));
  return rows.map(row => {
    const metadata = asRecord(row.metadataJson);
    const overlay = readDayLineOverlay(metadata);
    const hidden = metadata.hiddenFromDayPlan === true || overlay.notPursuing === true || Boolean(overlay.cancelledAt);
    const campaignId = stringField(metadata, "campaignId");
    const followUpId = stringField(metadata, "commercialFollowUpId") ?? stringField(metadata, "followUpId") ?? stringField(metadata, "followupId");
    const missionId = stringField(metadata, "missionId");
    const customerKey = stringField(metadata, "customerKey");
    const obligationId = obligationIdFrom(row.idempotencyKey) ?? stringField(metadata, "obligationId");
    const title = dayLineDisplayTitle(overlay, row.title);
    let grounding: WeeklyGrowthGrounding | null = null;
    if (row.kind === "growth") grounding = "growth_tagged";
    else if (campaignId) grounding = "campaign_linked";
    else if (obligationId?.startsWith("recovery:")) grounding = "proactive_recovery";
    else if (obligationId?.startsWith("sales:")) grounding = "sales";
    else if (followUpId) grounding = "commercial_follow_up";
    const operationalClass: WeeklyGrowthOperationalClass | null = row.kind === "operations" ? "admin" : null;
    return emptyRawRecord({
      tenantId: row.tenantId,
      operatorUserId: null,
      actorId: row.actorId,
      origin: "day_director_commitment",
      sourceId: row.id,
      title,
      objective: row.sourceText?.trim() || title,
      status: hidden ? "cancelled" : row.status,
      grounding,
      operationalClass,
      motionHint: grounding === "commercial_follow_up" || grounding === "sales" ? "commercial_follow_up" : grounding === "proactive_recovery" ? "customer_recovery" : null,
      campaignId,
      followUpId,
      missionId,
      customerKey,
      obligationId,
      commitmentId: row.id,
      dueDate: row.businessDate,
      alreadyInFlight: row.status === "open" && !hidden && row.kind === "growth",
    });
  });
}

async function readMissions(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<WeeklyGrowthRawRecord[]> {
  const missions = await listCommercialMissions({ tenantId: input.tenantId, assignedTo: input.operatorUserId });
  return missions.map(mission => emptyRawRecord({
    tenantId: mission.tenantId,
    operatorUserId: mission.assignedTo,
    origin: "commercial_mission",
    sourceId: String(mission.id),
    title: mission.account.name || mission.code,
    objective: mission.brief.salesAngle || mission.account.name,
    status: mission.status,
    grounding: "commercial_acquisition",
    motionHint: "account_acquisition",
    missionId: String(mission.id),
    alreadyInFlight: mission.status !== "candidate" && mission.status !== "won" && mission.status !== "lost",
  }));
}

async function readTasks(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<WeeklyGrowthRawRecord[]> {
  const tasks = await listOpsTasks({ tenantId: input.tenantId, limit: 500 });
  return tasks.flatMap(task => {
    const assigned = task.assignedTo ?? task.createdBy;
    if (assigned !== input.operatorUserId) return [];
    const metadata = asRecord(task.metadataJson);
    const campaignId = stringField(metadata, "campaignId");
    const mapped = GROWTH_OPS[task.taskType];
    const operationalClass = OPERATIONAL_OPS[task.taskType] ?? null;
    const grounding = mapped?.grounding ?? (campaignId ? "campaign_linked" : null);
    return [emptyRawRecord({
      tenantId: task.tenantId,
      operatorUserId: assigned,
      origin: "ops_task",
      sourceId: String(task.id),
      title: task.title,
      objective: task.description?.trim() || task.title,
      status: task.status,
      grounding,
      operationalClass,
      motionHint: mapped?.motion ?? null,
      campaignId,
      opsTaskId: String(task.id),
      customerKey: task.customerId != null ? String(task.customerId) : null,
      alreadyInFlight: task.status === "open" || task.status === "accepted" || task.status === "in_progress",
    })];
  });
}

async function readRuns(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<WeeklyGrowthRawRecord[]> {
  const runs = await listOperatorRuns({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
  return runs.map(run => emptyRawRecord({
    tenantId: run.tenantId,
    operatorUserId: run.operatorUserId,
    origin: "campaign_run",
    sourceId: run.campaignRunId,
    title: "",
    objective: "",
    status: run.status,
    grounding: "campaign_linked",
    campaignId: run.campaignId,
    runId: run.campaignRunId,
    alreadyInFlight: run.status === "active",
  }));
}

async function readFollowUps(input: {
  tenantId: string;
  timeZone: string;
}): Promise<SourceAvailability<WeeklyGrowthRawRecord>> {
  const db = await getDb();
  if (!db) throw new Error(DATABASE_UNAVAILABLE);
  const rows = await db.select().from(commercialFollowUps).where(eq(commercialFollowUps.tenantId, input.tenantId));
  return {
    status: "available",
    records: rows.map(row => {
      const utcDue = row.dueAt.toISOString().slice(0, 10);
      const dueDate = formatInTimeZone(row.dueAt, input.timeZone, "yyyy-MM-dd");
      return emptyRawRecord({
        tenantId: row.tenantId,
        operatorUserId: row.assignedTo,
        origin: "commercial_follow_up",
        sourceId: row.id,
        title: row.note,
        objective: row.note,
        status: row.status,
        grounding: "commercial_follow_up",
        motionHint: "commercial_follow_up",
        followUpId: row.id,
        missionId: String(row.missionId),
        dueDate,
        aliasKeys: [`obligation:sales:${row.missionId}:${utcDue}`],
        alreadyInFlight: false,
      });
    }),
  };
}

async function readObligations(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<SourceAvailability<WeeklyGrowthRawRecord>> {
  const obligations = await loadObligations(input.tenantId, input.operatorUserId);
  return { status: "available", records: obligations.map(obligation => obligationRecord(input, obligation)) };
}

function obligationRecord(
  input: { tenantId: string; operatorUserId: string },
  obligation: ProactiveObligation
): WeeklyGrowthRawRecord {
  const dormant = obligation.kind === "dormant_recovery";
  return emptyRawRecord({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    origin: "proactive_obligation",
    sourceId: obligation.id,
    title: obligation.title,
    objective: obligation.why,
    status: obligation.status,
    grounding: dormant ? "proactive_recovery" : obligation.kind === "sales_follow_up" ? "sales" : null,
    obligationKind: obligation.kind,
    motionHint: dormant ? "customer_recovery" : obligation.kind === "sales_follow_up" ? "commercial_follow_up" : null,
    obligationId: obligation.id,
    customerKey: dormant ? obligation.subjectKey : null,
    missionId: obligation.kind === "sales_follow_up" ? obligation.subjectKey : null,
    dueDate: obligation.dueDate,
    alreadyInFlight: obligation.status === "awaiting_result",
    fixture: obligation.id.startsWith("fixture:") || obligation.subjectKey.startsWith("fixture:"),
  });
}

async function readRecovery(input: { tenantId: string }): Promise<SourceAvailability<WeeklyGrowthRawRecord>> {
  const scan = await getLatestChurnScan(input.tenantId);
  if (!scan) return { status: "unavailable", reason: "no_churn_scan" };
  if (scan.status !== "completed") {
    return { status: "unavailable", reason: scan.errorMessage || `churn_scan_${scan.status}` };
  }
  return {
    status: "available",
    records: scan.customers.map(customer => emptyRawRecord({
      tenantId: input.tenantId,
      origin: "churn_snapshot",
      sourceId: customer.id,
      title: customer.customerName,
      objective: `Recovery candidate from churn scan ${scan.id}`,
      status: "scored",
      grounding: "proactive_recovery",
      motionHint: "customer_recovery",
      customerKey: customer.customerKey,
      existingScore: customer.score,
      historyOrderCount: customer.historyOrderCount,
      daysSinceLastOrder: customer.daysSinceLastOrder,
      activeOrderCount: customer.activeOrderCount,
      estimatedMonthlyImpactCents: customer.estimatedMonthlyImpactCents,
      averageOrderValueCents: customer.averageOrderValueCents,
      churnGrade: customer.grade,
      recommendedAction: customer.recommendedAction,
      confidence: customer.confidence,
      alreadyInFlight: false,
    })),
  };
}

async function readCampaigns(input: { tenantId: string }): Promise<SourceAvailability<WeeklyGrowthRawRecord>> {
  const campaigns = await listCampaigns({ tenantId: input.tenantId, includeDisabled: true });
  return { status: "available", records: campaigns.map(campaign => campaignRecord(campaign)) };
}

function campaignRecord(campaign: GrowthCampaign): WeeklyGrowthRawRecord {
  return emptyRawRecord({
    tenantId: campaign.tenantId,
    origin: "campaign_template",
    sourceId: campaign.campaignId,
    title: campaign.title,
    objective: campaign.objective,
    status: campaign.enabled ? "enabled" : "disabled",
    motionHint: campaign.missionCategory,
    campaignId: campaign.campaignId,
    prepLeadDays: campaign.prepLeadDays,
    prepCondition: campaign.prepCondition,
    pocketKind: pocket(campaign.pocketKind),
    minimumMinutes: campaign.pocketMinutesMin,
    assumptions: campaign.timingAssumptions.map(assumptionRecord),
    confidence: "low",
    alreadyInFlight: false,
  });
}

function assumptionRecord(assumption: TimingAssumption): WeeklyGrowthRawRecord["assumptions"][number] {
  return {
    text: assumption.assumption,
    source: assumption.source,
    recordedAt: assumption.recordedAt,
    confidence: null,
    evidenceClass: null,
  };
}

async function readMacro(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<SourceAvailability<WeeklyGrowthMacroSnapshot>> {
  const goal = await getActiveMacroGoal({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
  if (!goal) return { status: "available", records: [] };
  return {
    status: "available",
    records: [{ id: goal.id, metricKey: goal.metricKey, objective: goal.objective }],
  };
}

function obligationIdFrom(idempotencyKey: string): string | null {
  const prefix = "claire-proactive:";
  return idempotencyKey.startsWith(prefix) ? idempotencyKey.slice(prefix.length) : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function pocket(value: string): WeeklyGrowthPocketKind | null {
  if (value === "between_stops" || value === "open_ended" || value === "pre_route" || value === "post_route" || value === "any") {
    return value;
  }
  return null;
}

function unavailable(error: unknown): SourceAvailability<WeeklyGrowthRawRecord> {
  return { status: "unavailable", reason: error instanceof Error && error.message ? error.message : "source_unavailable" };
}

function unavailableMacro(error: unknown): SourceAvailability<WeeklyGrowthMacroSnapshot> {
  return { status: "unavailable", reason: error instanceof Error && error.message ? error.message : "source_unavailable" };
}

function unavailableBundle(reason: string): WeeklyGrowthSourceBundle {
  const down = { status: "unavailable" as const, reason };
  return {
    unfinished: down,
    commercialFollowUps: down,
    proactiveObligations: down,
    recovery: down,
    campaigns: down,
    macroGoal: down,
  };
}
