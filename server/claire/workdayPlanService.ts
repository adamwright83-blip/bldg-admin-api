import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dayDirectorCommitments } from "../../drizzle/schema";
import { getDb } from "../db";
import type { ClaireDriveContext } from "./contextAssembler";
import { assembleClaireRuntimeView } from "./runtimeView";
import {
  CLAIRE_WORKDAY_PLAN_KEY,
  detectWorkdaySession,
  diffWorkdayPlans,
  emptyWorkdayReconciliation,
  proposeTomorrowDraft,
  speakEveningPlan,
  speakMorningCommandOpening,
  workdayItemFromUnified,
  type ConfirmedWorkdayPlan,
  type WorkdayDelta,
  type WorkdayPlanItem,
  type WorkdayReconciliationState,
} from "../../shared/claireWorkday";

export function isHiddenWorkdayPlan(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as { hiddenFromDayPlan?: unknown }).hiddenFromDayPlan === true;
}

export function assembleTomorrowCandidates(context: ClaireDriveContext): WorkdayPlanItem[] {
  const runtime = context.runtime ?? assembleClaireRuntimeView(context);
  const selected = runtime.workItems.filter(
    item =>
      item.source.startsWith("tomorrow:") ||
      item.source.startsWith("openChannel:") ||
      item.detailState === "NEEDS_DETAILS" ||
      item.staleness === "overdue" ||
      item.staleness === "very_old"
  );
  const seen = new Set<string>();
  return selected
    .filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map(workdayItemFromUnified);
}

export function assembleTodayCandidates(context: ClaireDriveContext): WorkdayPlanItem[] {
  const runtime = context.runtime ?? assembleClaireRuntimeView(context);
  return runtime.workItems
    .filter(item => !item.source.startsWith("tomorrow:"))
    .map(workdayItemFromUnified);
}

function planIdempotencyKey(businessDate: string): string {
  return `${CLAIRE_WORKDAY_PLAN_KEY}:${businessDate}`;
}

export async function loadConfirmedWorkdayPlan(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
}): Promise<ConfirmedWorkdayPlan | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(dayDirectorCommitments)
      .where(
        and(
          eq(dayDirectorCommitments.tenantId, input.tenantId),
          eq(dayDirectorCommitments.actorId, input.actorId),
          eq(dayDirectorCommitments.businessDate, input.businessDate),
          eq(dayDirectorCommitments.idempotencyKey, planIdempotencyKey(input.businessDate))
        )
      )
      .limit(1);
    const snapshot = (row?.metadataJson as { snapshot?: ConfirmedWorkdayPlan } | null)?.snapshot;
    return snapshot && Array.isArray(snapshot.items) ? snapshot : null;
  } catch {
    return null;
  }
}

export async function confirmWorkdayPlan(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
  items: WorkdayPlanItem[];
  missingQuestion?: string | null;
  reconciliation?: WorkdayReconciliationState;
}): Promise<ConfirmedWorkdayPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await loadConfirmedWorkdayPlan(input);
  const snapshot: ConfirmedWorkdayPlan = {
    businessDate: input.businessDate,
    confirmedAt: new Date().toISOString(),
    actorId: input.actorId,
    items: input.items,
    missingQuestion: input.missingQuestion ?? null,
    reconciliation: input.reconciliation ?? existing?.reconciliation ?? emptyWorkdayReconciliation(),
  };
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.businessDate,
    idempotencyKey: planIdempotencyKey(input.businessDate),
    title: "Claire confirmed workday plan",
    kind: "operations" as const,
    quantity: null,
    provenance: "manual" as const,
    sourceText: `confirmed ${input.items.length} workday items`,
    metadataJson: {
      hiddenFromDayPlan: true,
      snapshot,
    },
  };
  await db
    .insert(dayDirectorCommitments)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        metadataJson: row.metadataJson,
        sourceText: row.sourceText,
        title: row.title,
      },
    });
  return snapshot;
}

export async function markWorkdayReconciliation(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
  status: "asked" | "complete";
}): Promise<WorkdayReconciliationState> {
  const existing = await loadConfirmedWorkdayPlan(input);
  const nowIso = new Date().toISOString();
  const previous = existing?.reconciliation ?? emptyWorkdayReconciliation();
  const reconciliation: WorkdayReconciliationState = {
    status: input.status,
    askedAt: input.status === "asked" ? previous.askedAt ?? nowIso : previous.askedAt,
    completedAt: input.status === "complete" ? nowIso : previous.completedAt,
  };
  await confirmWorkdayPlan({
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.businessDate,
    items: existing?.items ?? [],
    missingQuestion: existing?.missingQuestion ?? null,
    reconciliation,
  });
  return reconciliation;
}

export async function previewWorkdayLoop(input: {
  tenantId: string;
  actorId: string;
  context: ClaireDriveContext;
}): Promise<{
  session: ReturnType<typeof detectWorkdaySession>;
  tomorrowDraft: WorkdayPlanItem[];
  eveningSpeak: string;
  confirmed: ConfirmedWorkdayPlan | null;
  deltas: WorkdayDelta[];
  morningSpeak: string;
}> {
  const session = detectWorkdaySession({
    fieldSalesDayState: input.context.clock?.fieldSalesDayState,
    daypart: input.context.clock?.daypart,
  });
  const tomorrowDraft = proposeTomorrowDraft(assembleTomorrowCandidates(input.context));
  const planDate =
    session === "evening_planning"
      ? input.context.clock?.tomorrowBusinessDate ?? input.context.businessDate
      : input.context.businessDate;
  const confirmed = await loadConfirmedWorkdayPlan({
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: planDate,
  });
  const current =
    session === "evening_planning"
      ? tomorrowDraft
      : assembleTodayCandidates(input.context);
  const deltas = diffWorkdayPlans({ confirmed, current });
  const reconciliation = confirmed?.reconciliation ?? emptyWorkdayReconciliation();
  const morningSpeak = speakMorningCommandOpening(session, reconciliation, deltas);
  return {
    session,
    tomorrowDraft,
    eveningSpeak: speakEveningPlan(tomorrowDraft),
    confirmed,
    deltas,
    morningSpeak,
  };
}
