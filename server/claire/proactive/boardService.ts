import { loadSalesInsight, type SalesInsightArtifact } from "./salesInsights";
import { reconcileLedgerSpan } from "../../analytics/canonicalRevenue";
import { addDaysYmd, businessToday } from "../../analytics/businessPeriods";
import { groupCustomers } from "../../analytics/businessMetrics";
import { loadDataFreshness } from "../../analytics/dataFreshness";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { getDashboardTimeZone, zonedDayStartUtc } from "../../dashboardZoned";
import { acceptProposalWithReceipt } from "../../dayDirector/dayDirectorService";
import { listOpenCommercialFollowUps } from "../../commercialPipeline/commercialFollowUpReadService";
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
import {
  durableTriggerShadowEnabled,
  enqueueDurableTriggerForOperator,
} from "../../persistentOperator/goalCycleService";
import {
  backfillPersistentOperatorCommercialFollowUpRef,
  claireProactiveObligations,
  listPersistentOperatorObligationPayloads,
  upsertPersistentOperatorObligation,
} from "../../persistentOperator/obligationStore";
import {
  loadOperatorDoctrine,
  saveOperatorDoctrine,
} from "../../persistentOperator/operatorDoctrineStore";

// Compatibility export: persistent-operator core owns the durable obligation table.
export { claireProactiveObligations };


const lastSweepAtByOperator = new Map<string, number>();
const SWEEP_MS = 60_000;
const surfacedSalesInsights = new Map<string, string>();

function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

export async function loadDoctrine(
  tenantId: string,
  operatorUserId: string
): Promise<DoctrineRules> {
  return loadOperatorDoctrine({ tenantId, operatorUserId });
}

export async function saveDoctrine(
  tenantId: string,
  operatorUserId: string,
  rules: DoctrineRules
): Promise<void> {
  await saveOperatorDoctrine({ tenantId, operatorUserId, rules });
}

/**
 * Read the operator's existing proactive obligations. Pure read — it creates nothing.
 *
 * `ensureOperatorBoard` is the sweep that WRITES obligations; an observer must never call
 * it. This is the read-only view of what the board already holds.
 */
export async function loadObligations(
  tenantId: string,
  operatorUserId: string
): Promise<ProactiveObligation[]> {
  return listPersistentOperatorObligationPayloads({ tenantId, operatorUserId });
}

async function upsertObligation(
  tenantId: string,
  operatorUserId: string,
  obligation: ProactiveObligation,
  lineage?: { commercialFollowUpRef?: string | null }
): Promise<void> {
  await upsertPersistentOperatorObligation({
    tenantId,
    operatorUserId,
    obligation,
    commercialFollowUpRef: lineage?.commercialFollowUpRef ?? null,
  });
}

async function backfillObligationCommercialFollowUpRef(input: {
  tenantId: string;
  operatorUserId: string;
  obligationId: string;
  commercialFollowUpRef: string;
}): Promise<void> {
  await backfillPersistentOperatorCommercialFollowUpRef(input);
}

async function placeOnDayLine(input: {
  tenantId: string;
  actorId: string;
  dueDate: string;
  title: string;
  idempotencyKey: string;
  sourceText: string;
}): Promise<void> {
  const result = await acceptProposalWithReceipt({
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.dueDate,
    proposal: {
      promptKey: input.idempotencyKey.slice(0, 191),
      title: input.title.slice(0, 255),
      kind: "growth",
      quantity: null,
      sourceText: input.sourceText,
      prerequisites: [],
      question: null,
      intelligence: "manual_fallback",
      detailState: "COMPLETE",
      missingDetails: [],
      targetBusinessDate: input.dueDate,
    },
  });
  if (!result.stored?.id) {
    throw new Error("Proactive Day Line item was not persisted");
  }
}

export async function ensureOperatorBoard(input: {
  tenantId: string;
  operatorUserId: string;
  actorId: string;
  timeZone: string;
  recoveryDraftIdentity: {
    storeName: string;
    senderName: string;
    serviceLabel: string;
  };
  force?: boolean;
}): Promise<{ brief: string; created: number ; salesArtifacts?: SalesInsightArtifact[] }> {
  if (!isStrategyFeatureEnabled(input.tenantId, STRATEGY_FLAGS.LEGACY_AUTONOMY)) {
    return { brief: "", created: 0 };
  }
  const now = Date.now();
  const sweepKey = `${input.tenantId}:${input.operatorUserId}`;
  const lastSweepAt = lastSweepAtByOperator.get(sweepKey) ?? 0;
  if (!input.force && now - lastSweepAt < SWEEP_MS) {
    return { brief: "", created: 0 };
  }
  lastSweepAtByOperator.set(sweepKey, now);
  const timeZone = input.timeZone;
  const today = businessToday(new Date(), timeZone);
  if (durableTriggerShadowEnabled()) {
    void enqueueDurableTriggerForOperator({
      tenantId: input.tenantId,
      operatorOpenId: input.operatorUserId,
      triggerType: "scheduled_tick",
      triggerSourceReference: `proactive_obligation_sweep:${input.operatorUserId}:${today}`,
      idempotencyKey: `proactive_obligation_sweep:${input.operatorUserId}:${today}`,
      availableAt: new Date(now),
    }).catch(error => {
      console.warn(
        "[ClaireProactive] Durable trigger shadow enqueue failed",
        error instanceof Error ? error.message : error
      );
    });
  }
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
    customers = groupCustomers(reconcileLedgerSpan(ledger, { start: "2020-01-01", end: today }).includedEvents)
      .filter(group => group.matched && group.records.some(record => record.cents > 0))
      .map(group => {
        const sorted = group.records.filter(record => record.cents > 0).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
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
      storeName: input.recoveryDraftIdentity.storeName,
      senderName: input.recoveryDraftIdentity.senderName,
      lastServiceLabel: input.recoveryDraftIdentity.serviceLabel,
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
      const due = await listOpenCommercialFollowUps(input.tenantId);
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
        const existing = already.find(item => item.id === obligation.id);
        if (existing) {
          // PR4 lineage backfill must never replay the obligation constructor
          // over durable workflow state. Existing obligations may already be
          // draft_prepared, awaiting_result, completed, or cancelled and may
          // carry accumulated payload state that a fresh scheduled payload
          // does not know about.
          await backfillObligationCommercialFollowUpRef({
            tenantId: input.tenantId,
            operatorUserId: input.operatorUserId,
            obligationId: existing.id,
            commercialFollowUpRef: follow.id,
          });
          continue;
        }
        await upsertObligation(
          input.tenantId,
          input.operatorUserId,
          obligation,
          { commercialFollowUpRef: follow.id }
        );
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

  const insight = await loadSalesInsight(input.tenantId, new Date(now), timeZone).catch(() => null);
  const freshInsight = insight && surfacedSalesInsights.get(sweepKey) !== insight.observationReference ? insight : null;
  if (freshInsight) surfacedSalesInsights.set(sweepKey, freshInsight.observationReference);
  return {
    created,
    salesArtifacts: freshInsight ? [freshInsight] : [],
    brief: [freshInsight?.speech, morningChiefOfStaffBrief({
      recoveries: obligations.filter(item => item.kind === "dormant_recovery"),
      sales: obligations.filter(item => item.kind === "sales_follow_up" && item.status === "scheduled"),
      warnings,
      overload: overloadJudgment([]),
      skipSales,
    })].filter(Boolean).join(" "),
  };
}

/**
 * Legacy founder compatibility only. New persistent-operator code must call
 * ensureOperatorBoard with tenant-owned timezone and sender identity.
 */
export async function ensureAdamBoard(input: {
  tenantId: string;
  operatorUserId: string;
  actorId: string;
  force?: boolean;
}): Promise<{ brief: string; created: number ; salesArtifacts?: SalesInsightArtifact[] }> {
  return ensureOperatorBoard({
    ...input,
    timeZone: getDashboardTimeZone(),
    recoveryDraftIdentity: {
      storeName: "Laundry Butler",
      senderName: "Adam",
      serviceLabel: "laundry",
    },
  });
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
