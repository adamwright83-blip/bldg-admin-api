import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { index, json, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { commercialFollowUps, dayDirectorCommitments } from "../../../drizzle/schema";
import { addDaysYmd, businessToday } from "../../analytics/businessPeriods";
import { groupCustomers } from "../../analytics/businessMetrics";
import { loadDataFreshness } from "../../analytics/dataFreshness";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { getDashboardTimeZone, zonedDayStartUtc } from "../../dashboardZoned";
import { getDb } from "../../db";
import {
  DEFAULT_DOCTRINE,
  applyDoctrineUtterance,
  explainWhyOnToday,
  gumballWarning,
  isDormantEligible,
  morningChiefOfStaffBrief,
  overloadJudgment,
  proposeRecoveryObligation,
  salesFollowUpObligation,
  scheduleRecoveryDays,
  supersedeIfReordered,
  whyPushingSales,
  type CustomerEvidence,
  type DoctrineRules,
  type ProactiveObligation,
} from "../../../shared/claireProactive";
import { buildWinBackDraft, scoreCustomerChurn } from "../../../shared/customerChurn";
import { isStrategyFeatureEnabled, STRATEGY_FLAGS } from "../../../shared/strategyFeatureFlags";
import { requiresSpendClearance } from "../../strategy/spendClearance";

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

function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

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

export async function ensureAdamBoard(input: {
  tenantId: string;
  operatorUserId: string;
  actorId: string;
  force?: boolean;
}): Promise<{ brief: string; created: number }> {
  if (!isStrategyFeatureEnabled(input.tenantId, STRATEGY_FLAGS.LEGACY_AUTONOMY)) {
    return { brief: "", created: 0 };
  }
  const now = Date.now();
  if (!input.force && now - lastSweepAt < SWEEP_MS) return { brief: "", created: 0 };
  lastSweepAt = now;
  const db = await getDb();
  if (!db) return { brief: "", created: 0 };
  const timeZone = getDashboardTimeZone();
  const today = businessToday(new Date(), timeZone);
  const rules = await loadDoctrine(input.tenantId, input.operatorUserId);
  let created = 0;

  let customers: CustomerEvidence[] = [];
  try {
    const ledger = await loadPaidOrderLedger({
      tenantId: input.tenantId,
      startUtc: zonedDayStartUtc("2020-01-01", timeZone),
      endExclusiveUtc: new Date(now + 86_400_000),
      timeZone,
    });
    customers = groupCustomers(ledger.events)
      .filter(group => group.matched)
      .map(group => {
        const sorted = [...group.records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const last = sorted[sorted.length - 1]!;
        const intervals = sorted
          .slice(1)
          .map((item, index) => daysBetween(item.businessDate, sorted[index]!.businessDate))
          .filter(days => days > 0 && days <= 120);
        const cadence = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null;
        const name = [...sorted].reverse().find(record => record.customerName)?.customerName ?? "an unnamed customer";
        return {
          identityKey: group.identityId,
          displayName: name,
          paidOrderCount: sorted.length,
          lastPaidOn: last.businessDate,
          daysSinceLastPaid: Math.max(0, daysBetween(today, last.businessDate)),
          expectedCadenceDays: cadence,
          openOrderCount: 0,
          lastOutreachOn: null,
          attestedOutreachOn: null,
        };
      });
  } catch (error) {
    console.warn("[ClaireProactive] ledger unavailable", error instanceof Error ? error.message : error);
  }

  for (const customer of customers) {
    const open = (await loadObligations(input.tenantId, input.operatorUserId)).find(
      item => item.kind === "dormant_recovery" && item.subjectKey === customer.identityKey && (item.status === "scheduled" || item.status === "draft_prepared")
    );
    if (open && customer.daysSinceLastPaid < 7) {
      await upsertObligation(input.tenantId, input.operatorUserId, supersedeIfReordered(open, customer.lastPaidOn));
    }
  }

  const live = await loadObligations(input.tenantId, input.operatorUserId);
  const eligible = customers.filter(customer => isDormantEligible(customer, rules, today, live).eligible);
  const skipSales = rules.skipSalesUntil === today;
  const placed = scheduleRecoveryDays({
    today,
    customers: eligible.slice(0, 8),
    rules,
    dayLoads: {},
    overloadedToday: true,
  });

  for (const { customer, dueDate } of placed) {
    const current = await loadObligations(input.tenantId, input.operatorUserId);
    const check = isDormantEligible(customer, rules, today, current);
    if (!check.eligible) continue;
    const score = scoreCustomerChurn({
      customerKey: customer.identityKey,
      customerName: customer.displayName,
      history: Array.from({ length: Math.max(2, customer.paidOrderCount) }, (_, index) => ({
        orderId: index + 1,
        serviceAt: `${addDaysYmd(customer.lastPaidOn, -14 * (customer.paidOrderCount - index))}T12:00:00.000Z`,
        valueCents: 5000,
        weightLbs: null,
        serviceType: "wash_fold" as const,
      })),
      now: new Date(`${today}T16:00:00.000Z`),
    });
    const draft = buildWinBackDraft({
      score,
      storeName: "Laundry Butler",
      senderName: "Adam",
      lastServiceLabel: "laundry",
    });
    const obligation = proposeRecoveryObligation(customer, dueDate, check.why, draft.message);
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
      console.warn("[ClaireProactive] sales follow-ups unavailable", error instanceof Error ? error.message : error);
    }
  }

  const obligations = await loadObligations(input.tenantId, input.operatorUserId);
  const warnings: string[] = [];
  try {
    const freshness = await loadDataFreshness({ tenantId: input.tenantId, timeZone });
    const warning = gumballWarning({
      gumballImportedToday: freshness.gumball.receipts.some(receipt => receipt.status === "imported" && receipt.at.slice(0, 10) === today),
      lastSuccessAt: freshness.gumball.lastSuccessAt,
      cleanCloudThrough: freshness.cleancloud.latestSale?.paidAt?.slice(0, 10) ?? null,
      today,
      failedAttemptToday: (freshness.gumball.attempts ?? []).some(attempt => attempt.at.slice(0, 10) === today && attempt.outcome !== "imported"),
      unknownFailures: freshness.gumball.attempts === null,
    });
    if (warning) warnings.push(warning);
  } catch {
    /* optional */
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

export async function requiresPr148SpendClearance(input: {
  tenantId: string;
  amountCents: number;
  category?: string;
}): Promise<{ allowed: boolean; reason: string }> {
  const clearance = await requiresSpendClearance({
    tenantId: input.tenantId,
    category: input.category ?? "paid_growth",
    amountCents: input.amountCents,
  });
  return { allowed: clearance.cleared, reason: clearance.reason };
}
