import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { index, json, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { commercialFollowUps, dayDirectorCommitments } from "../../../drizzle/schema";
import { addDaysYmd, businessToday } from "../../analytics/businessPeriods";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import { loadJawbreakerPipelineStatus, speakJawbreakerPipelineStatus } from "../../jawbreaker/status";
import {
  DEFAULT_DOCTRINE,
  applyDoctrineUtterance,
  explainWhyOnToday,
  isDormantEligible,
  morningChiefOfStaffBrief,
  overloadJudgment,
  proposeRecoveryObligation,
  salesFollowUpObligation,
  scheduleRecoveryDays,
  supersedeIfReordered,
  whyPushingSales,
  type DoctrineRules,
  type ProactiveObligation,
} from "../../../shared/claireProactive";
import { buildTruthfulRecoveryDraft, loadCustomerEvidence } from "./customerEvidence";

export const claireOperatorDoctrine = mysqlTable(
  "claire_operator_doctrine",
  {
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    rulesJson: json("rulesJson").notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    pk: uniqueIndex("uq_claire_operator_doctrine").on(table.tenantId, table.operatorUserId),
  })
);

export const claireProactiveObligations = mysqlTable(
  "claire_proactive_obligations",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    kind: mysqlEnum("kind", ["dormant_recovery", "sales_follow_up", "data_health"]).notNull(),
    subjectKey: varchar("subjectKey", { length: 191 }).notNull(),
    payloadJson: json("payloadJson").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    dueDate: varchar("dueDate", { length: 10 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    openIdx: index("idx_claire_proactive_open").on(table.tenantId, table.operatorUserId, table.status, table.dueDate),
  })
);

let lastSweepAt = 0;
const SWEEP_MS = 60_000;

export async function loadDoctrine(tenantId: string, operatorUserId: string): Promise<DoctrineRules> {
  const db = await getDb();
  if (!db) return DEFAULT_DOCTRINE;
  try {
    const [row] = await db
      .select()
      .from(claireOperatorDoctrine)
      .where(and(eq(claireOperatorDoctrine.tenantId, tenantId), eq(claireOperatorDoctrine.operatorUserId, operatorUserId)))
      .limit(1);
    return row?.rulesJson ? { ...DEFAULT_DOCTRINE, ...(row.rulesJson as DoctrineRules) } : DEFAULT_DOCTRINE;
  } catch {
    return DEFAULT_DOCTRINE;
  }
}

export async function saveDoctrine(tenantId: string, operatorUserId: string, rules: DoctrineRules): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(claireOperatorDoctrine)
    .values({ tenantId, operatorUserId, rulesJson: rules })
    .onDuplicateKeyUpdate({ set: { rulesJson: rules } });
}

async function loadObligations(tenantId: string, operatorUserId: string): Promise<ProactiveObligation[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(claireProactiveObligations)
      .where(and(eq(claireProactiveObligations.tenantId, tenantId), eq(claireProactiveObligations.operatorUserId, operatorUserId)));
    return rows.map(row => row.payloadJson as ProactiveObligation);
  } catch {
    return [];
  }
}

async function upsertObligation(tenantId: string, operatorUserId: string, obligation: ProactiveObligation): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(claireProactiveObligations)
    .values({
      id: obligation.id,
      tenantId,
      operatorUserId,
      kind: obligation.kind,
      subjectKey: obligation.subjectKey,
      payloadJson: obligation,
      status: obligation.status,
      dueDate: obligation.dueDate,
    })
    .onDuplicateKeyUpdate({
      set: { payloadJson: obligation, status: obligation.status, dueDate: obligation.dueDate },
    });
}

async function placeOnDayLine(input: {
  tenantId: string;
  actorId: string;
  dueDate: string;
  title: string;
  idempotencyKey: string;
  sourceText: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.dueDate,
    idempotencyKey: input.idempotencyKey.slice(0, 191),
    title: input.title.slice(0, 255),
    kind: "growth" as const,
    quantity: null,
    provenance: "manual" as const,
    sourceText: input.sourceText,
    metadataJson: { claireProactive: true, detailState: "COMPLETE", missingDetails: [] },
  };
  await db.insert(dayDirectorCommitments).values(row).onDuplicateKeyUpdate({ set: { title: row.title } });
}

function pipelineWarning(status: Awaited<ReturnType<typeof loadJawbreakerPipelineStatus>>): string | null {
  const pending = status.jawbreaker.pendingCount;
  const successAt = status.jawbreaker.latestSuccess?.at ?? null;
  const failureAt = status.jawbreaker.latestFailure?.at ?? null;
  const exportAt = status.gumball.latestExport?.at ?? null;
  if (pending !== null && pending > 0) return speakJawbreakerPipelineStatus(status);
  if (failureAt && (!successAt || failureAt > successAt)) return speakJawbreakerPipelineStatus(status);
  if (exportAt && (!successAt || exportAt > successAt)) return speakJawbreakerPipelineStatus(status);
  return null;
}

export async function ensureAdamBoard(input: {
  tenantId: string;
  operatorUserId: string;
  actorId: string;
  force?: boolean;
}): Promise<{ brief: string; created: number }> {
  const now = Date.now();
  if (!input.force && now - lastSweepAt < SWEEP_MS) return { brief: "", created: 0 };
  lastSweepAt = now;
  const db = await getDb();
  if (!db) return { brief: "", created: 0 };
  const timeZone = getDashboardTimeZone();
  const today = businessToday(new Date(now), timeZone);
  const rules = await loadDoctrine(input.tenantId, input.operatorUserId);
  let created = 0;

  let customers = [] as Awaited<ReturnType<typeof loadCustomerEvidence>>["customers"];
  try {
    customers = (
      await loadCustomerEvidence({
        tenantId: input.tenantId,
        now: new Date(now),
        timeZone,
      })
    ).customers;
  } catch (error) {
    console.warn(
      "[ClaireProactive] customer evidence unavailable",
      error instanceof Error ? error.message : error
    );
  }

  const beforeSweep = await loadObligations(input.tenantId, input.operatorUserId);
  for (const customer of customers) {
    const open = beforeSweep.find(
      item =>
        item.kind === "dormant_recovery" &&
        item.subjectKey === customer.identityKey &&
        (item.status === "scheduled" || item.status === "draft_prepared" || item.status === "awaiting_result")
    );
    // Existing V1 obligations do not persist the basis last-order date. A very
    // recent real paid order is nevertheless sufficient evidence that an old
    // dormant-recovery obligation is obsolete; preserve its history and mark it
    // superseded instead of deleting it.
    if (open && customer.daysSinceLastPaid < rules.dormantQuietDays) {
      await upsertObligation(
        input.tenantId,
        input.operatorUserId,
        supersedeIfReordered(open, customer.lastPaidOn)
      );
    }
  }

  const live = await loadObligations(input.tenantId, input.operatorUserId);
  const eligible = customers.filter(
    customer => isDormantEligible(customer, rules, today, live).eligible
  );
  const skipSales = rules.skipSalesUntil === today;
  const placed = scheduleRecoveryDays({
    today,
    customers: eligible,
    rules,
    dayLoads: {},
    overloadedToday: true,
  }).slice(0, 8);

  for (const { customer, dueDate } of placed) {
    const current = await loadObligations(input.tenantId, input.operatorUserId);
    const check = isDormantEligible(customer, rules, today, current);
    if (!check.eligible) continue;
    const draftMessage = buildTruthfulRecoveryDraft(customer);
    const obligation = proposeRecoveryObligation(
      customer,
      dueDate,
      check.why,
      draftMessage
    );
    await upsertObligation(input.tenantId, input.operatorUserId, obligation);
    await placeOnDayLine({
      tenantId: input.tenantId,
      actorId: input.actorId,
      dueDate,
      title: obligation.title,
      idempotencyKey: `claire-proactive:${obligation.id}`,
      sourceText: `${obligation.why} Rook draft is prepared; sending still needs you.`,
    });
    created += 1;
  }

  if (!skipSales) {
    try {
      const due = await db
        .select()
        .from(commercialFollowUps)
        .where(and(eq(commercialFollowUps.tenantId, input.tenantId), eq(commercialFollowUps.status, "open")));
      const already = await loadObligations(input.tenantId, input.operatorUserId);
      for (const follow of due.slice(0, 5)) {
        const dueDate = follow.dueAt.toISOString().slice(0, 10);
        if (dueDate > addDaysYmd(today, 7)) continue;
        const name = `Mission ${follow.missionId}`;
        const obligation = salesFollowUpObligation({
          accountKey: String(follow.missionId),
          accountName: name,
          dueDate,
          nextStep: follow.note,
          lastOutcome: null,
          history: [follow.note],
        });
        if (already.some(item => item.id === obligation.id)) continue;
        await upsertObligation(input.tenantId, input.operatorUserId, obligation);
        await placeOnDayLine({
          tenantId: input.tenantId,
          actorId: input.actorId,
          dueDate: dueDate < today ? today : dueDate,
          title: obligation.title,
          idempotencyKey: `claire-proactive:${obligation.id}`,
          sourceText: obligation.why,
        });
        created += 1;
      }
    } catch (error) {
      console.warn(
        "[ClaireProactive] sales follow-ups unavailable",
        error instanceof Error ? error.message : error
      );
    }
  }

  const obligations = await loadObligations(input.tenantId, input.operatorUserId);
  const warnings: string[] = [];
  try {
    const pipeline = await loadJawbreakerPipelineStatus({
      tenantId: input.tenantId,
      timeZone,
      now: new Date(now),
    });
    const warning = pipelineWarning(pipeline);
    if (warning) warnings.push(warning);
  } catch {
    // Pipeline health is useful context, not permission to invent a failure.
  }

  return {
    created,
    brief: morningChiefOfStaffBrief({
      recoveries: obligations.filter(item => item.kind === "dormant_recovery"),
      sales: obligations.filter(item => item.kind === "sales_follow_up" && item.status === "scheduled"),
      warnings,
      overload: overloadJudgment([]),
      skipSales,
    }),
  };
}

export async function explainProactive(tenantId: string, operatorUserId: string, utterance: string): Promise<string | null> {
  const lower = utterance.toLowerCase();
  const rules = await loadDoctrine(tenantId, operatorUserId);
  if (/\bsales\b/.test(lower) && /\bpush(?:ing)?|why are you\b/.test(lower)) {
    return whyPushingSales(rules.skipSalesUntil === businessToday(new Date(), getDashboardTimeZone()));
  }
  const items = await loadObligations(tenantId, operatorUserId);
  const hit = items.find(item => {
    const first = item.subjectName.split(/\s+/)[0]?.toLowerCase() ?? "";
    return (first && lower.includes(first)) || lower.includes(item.title.toLowerCase());
  });
  return hit ? explainWhyOnToday(hit) : null;
}

export async function handleDoctrineTurn(input: {
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  today: string;
}): Promise<string | null> {
  const rules = await loadDoctrine(input.tenantId, input.operatorUserId);
  const applied = applyDoctrineUtterance(rules, input.utterance, input.today);
  if (!applied) return null;
  if (!("rules" in applied)) return applied.speak;
  await saveDoctrine(input.tenantId, input.operatorUserId, applied.rules);
  return applied.speak;
}

export { applyDoctrineUtterance };
