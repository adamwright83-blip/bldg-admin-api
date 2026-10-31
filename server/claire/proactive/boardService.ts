import { loadSalesInsight, type SalesInsightArtifact } from "./salesInsights";
import { deriveRecoverySafety, loadRecoverySafetyEvidence } from "./recoveryEvidence";
import { reconcileLedgerSpan } from "../../analytics/canonicalRevenue";
import { addDaysYmd, businessToday } from "../../analytics/businessPeriods";
import { groupCustomers } from "../../analytics/businessMetrics";
import { loadDataFreshness } from "../../analytics/dataFreshness";
import { customerTruthDispositionOf, type CustomerTruthDisposition } from "../../analytics/sourceCoverage";
import {
  loadDormantContactFacts,
  permissionForKeys,
  type DormantContactFacts,
} from "../../strategy/dormantOutreachGate";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { getDashboardTimeZone, zonedDayStartUtc } from "../../dashboardZoned";
import {
  listCommercialFollowUpStates,
  listOpenCommercialFollowUps,
} from "../../domains/commercial/commercialFollowUpReadService";
import {
  DEFAULT_DOCTRINE,
  applyDoctrineUtterance,
  closeSalesFollowUpIfMoved,
  explainWhyOnToday,
  gumballWarning,
  isDormantEligible,
  morningChiefOfStaffBrief,
  overloadJudgment,
  parseSalesHoldInstruction,
  proposeRecoveryObligation,
  salesFollowUpObligation,
  salesHeldOn,
  salesHoldCovers,
  scheduleRecoveryDays,
  supersedeIfReordered,
  whyPushingSales,
  type CustomerEvidence,
  type DoctrineRules,
  type ProactiveObligation,
} from "../../../shared/claireProactive";
import { buildWinBackDraft, scoreCustomerChurn } from "../../../shared/customerChurn";
import { observedChurnHistory } from "./observedChurnHistory";
import type { CustomerHistoryObservation } from "../../../shared/customerChurn";
import { isStrategyFeatureEnabled, STRATEGY_FLAGS } from "../../../shared/strategyFeatureFlags";
import { requiresSpendClearance } from "../../strategy/spendClearance";
import {
  durableTriggerShadowEnabled,
  enqueueDurableTriggerForOperator,
} from "../../agents/persistentOperator/goalCycleService";
import {
  backfillPersistentOperatorCommercialFollowUpRef,
  claireProactiveObligations,
  listPersistentOperatorObligationPayloads,
  listPersistentOperatorObligationRecords,
  upsertPersistentOperatorObligation,
} from "../../agents/persistentOperator/obligationStore";
import {
  loadOperatorDoctrine,
  saveOperatorDoctrine,
} from "../../agents/persistentOperator/operatorDoctrineStore";
import {
  loadOperatorSalesHoldFor,
  operatorBusinessDate,
  recordOperatorSalesHoldInstruction,
} from "../../agents/persistentOperator/salesHoldInstruction";

// Compatibility export: persistent-operator core owns the durable obligation table.
export { claireProactiveObligations };


const lastSweepAtByOperator = new Map<string, number>();
const SWEEP_MS = 60_000;
const surfacedSalesInsights = new Map<string, string>();

function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

/** The day a commercial follow-up's board copy is keyed by. */
function followUpDueDate(dueAt: Date): string {
  return dueAt.toISOString().slice(0, 10);
}

/** States in which a board copy is closed. */
const CLOSED_OBLIGATION_STATUSES = new Set(["superseded", "completed", "cancelled"]);

/** Words too common to identify anything on the board on their own. */
const UNIDENTIFYING_WORDS = new Set(["the", "a", "an", "of", "and", "at"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a lower-cased utterance contains `phrase` as whole words. */
function mentionsPhrase(lower: string, phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const body = words.map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "u").test(lower);
}

/**
 * Whether an utterance names this obligation: its full name or title as whole
 * words. A win-back may also be named by the customer's first name, when that
 * word is distinctive; an account is named in full ("The Standard", not "the";
 * "W Hollywood", not the "w" in "why").
 */
function utteranceNamesObligation(lower: string, item: ProactiveObligation): boolean {
  if (mentionsPhrase(lower, item.subjectName) || mentionsPhrase(lower, item.title)) return true;
  if (item.kind === "sales_follow_up") return false;
  const first = item.subjectName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first.length >= 3 && !UNIDENTIFYING_WORDS.has(first) && mentionsPhrase(lower, first);
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

/**
 * Structured, fact-preserving spoken summary. Never infers dormancy, rewrites
 * customer history, or speaks every recovery identity without a request.
 */
export function conciseOperatorBoardSpeech(input: {
  warnings: readonly string[];
  recoveries: readonly ProactiveObligation[];
  sales: readonly ProactiveObligation[];
  overload: ReturnType<typeof overloadJudgment>;
  skipSales: boolean;
  /** The operator held win-backs today: recovery is not pushed. */
  skipRecovery?: boolean;
}): string {
  const lines: string[] = [];
  const warning = input.warnings[0];
  if (warning) {
    if (warning.startsWith("GUMBALL failed today.")) lines.push("GUMBALL import failed today.");
    else if (warning.startsWith("GUMBALL did not run today.")) lines.push("GUMBALL did not import today.");
    else if (warning.startsWith("CleanCloud is only current")) lines.push("CleanCloud data freshness is uncertain.");
    else lines.push(warning); // Unknown critical warnings must not be dropped.
  }
  if (input.overload.kind !== "ok") lines.push(input.overload.speak);
  const recoveries = input.skipRecovery ? [] : input.recoveries.filter(item =>
    item.status === "scheduled" || item.status === "draft_prepared"
  );
  if (recoveries.length) {
    lines.push(warning
      ? "Recovery candidates need verification before outreach."
      : "Recovery follow-ups are on the board; ask for details before outreach.");
  }
  const nextSale = input.skipSales ? null :
    input.sales.find(item => item.status === "scheduled");
  if (nextSale) lines.push(`Next sales follow-up: ${nextSale.title}.`);
  return lines.length
    ? lines.join(" ")
    : "Nothing urgent is on the board. Ask if you'd like the full detail.";
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
}): Promise<{ brief: string; conciseBrief?: string; created: number; salesArtifacts?: SalesInsightArtifact[] }> {
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

  const verifiedHistoryByIdentity = new Map<string, CustomerHistoryObservation[]>();
  let customers: CustomerEvidence[] = [];
  let ledgerUnreadable = false;
  let outreachDisposition: CustomerTruthDisposition = "source_unavailable";
  let contactFacts: DormantContactFacts | null = null;
  try {
    const [ledger, safetyEvidence, facts] = await Promise.all([
      loadPaidOrderLedger({
        tenantId: input.tenantId,
        startUtc: zonedDayStartUtc("2020-01-01", timeZone),
        endExclusiveUtc: new Date(now + 86_400_000),
        timeZone,
      }),
      loadRecoverySafetyEvidence({
        tenantId: input.tenantId,
        now: new Date(now),
        cooldownDays: rules.outreachCooldownDays,
      }).catch(() => null),
      loadDormantContactFacts({
        tenantId: input.tenantId,
        now: new Date(now),
        cooldownDays: rules.outreachCooldownDays,
      }).catch(() => null),
    ]);
    contactFacts = facts;
    outreachDisposition = customerTruthDispositionOf(safetyEvidence?.coverage ?? null);
    customers = groupCustomers(reconcileLedgerSpan(ledger, { start: "2020-01-01", end: today }).includedEvents)
      .filter(group => group.matched && group.records.some(record => record.cents > 0))
      .map(group => {
        const sorted = group.records.filter(record => record.cents > 0).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const history = observedChurnHistory(sorted);
        if (history) verifiedHistoryByIdentity.set(group.identityId, history);
        const last = sorted[sorted.length - 1]!;
        const intervals = sorted
          .slice(1)
          .map((item, index) => daysBetween(item.businessDate, sorted[index]!.businessDate))
          .filter(days => days > 0 && days <= 120);
        const cadence = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null;
        const name = [...sorted].reverse().find(record => record.customerName)?.customerName ?? "an unnamed customer";
        const safety = safetyEvidence ? deriveRecoverySafety({
          tenantId: input.tenantId,
          identityKeys: [group.identityId],
          nativeOrders: safetyEvidence.nativeOrders,
          coverage: safetyEvidence.coverage,
          recoveries: safetyEvidence.recoveries,
          communications: safetyEvidence.communications,
        }) : null;
        return {
          identityKey: group.identityId,
          displayName: name,
          paidOrderCount: sorted.length,
          lastPaidOn: last.businessDate,
          daysSinceLastPaid: Math.max(0, daysBetween(today, last.businessDate)),
          expectedCadenceDays: cadence,
          openOrderCount: safety?.openOrderCount ?? 1,
          lastOutreachOn: safety?.lastOutreachOn ?? null,
          attestedOutreachOn: safety?.attestedOutreachOn ?? null,
        };
      });
  } catch (error) {
    ledgerUnreadable = true;
    console.warn("[ClaireProactive] ledger unavailable", error instanceof Error ? error.message : error);
  }
  const mayNameCustomers =
    !ledgerUnreadable && outreachDisposition === "current" && contactFacts?.readable === true;

  for (const customer of customers) {
    const open = (await loadObligations(input.tenantId, input.operatorUserId)).find(
      item => item.kind === "dormant_recovery" && item.subjectKey === customer.identityKey && (item.status === "scheduled" || item.status === "draft_prepared")
    );
    if (open && customer.daysSinceLastPaid < 7) {
      await upsertObligation(input.tenantId, input.operatorUserId, supersedeIfReordered(open, customer.lastPaidOn));
    }
  }

  const live = await loadObligations(input.tenantId, input.operatorUserId);
  const eligible = mayNameCustomers
    ? customers.filter(customer => isDormantEligible(customer, rules, today, live).eligible)
    : [];
  // The operator's hold, read across every open id: held follow-ups are not
  // created, and held win-backs are neither placed on a held day nor pushed.
  const hold = await loadOperatorSalesHoldFor({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
  const skipSales = salesHoldCovers(hold, today, "commercial_follow_up");
  const skipRecovery = salesHoldCovers(hold, today, "customer_recovery");
  const placed = scheduleRecoveryDays({
    today,
    customers: eligible.slice(0, 8),
    rules,
    dayLoads: {},
    overloadedToday: true,
  });

  for (const { customer, dueDate } of placed) {
    if (salesHoldCovers(hold, dueDate, "customer_recovery")) continue;
    const current = await loadObligations(input.tenantId, input.operatorUserId);
    const check = isDormantEligible(customer, rules, today, current);
    if (!check.eligible) continue;
    const phoneDigits = customer.identityKey.startsWith("phone:")
      ? customer.identityKey.slice("phone:".length)
      : "";
    if (phoneDigits.length !== 10 || !contactFacts) continue;
    if (permissionForKeys(contactFacts, input.tenantId, [customer.identityKey]).state !== "opted_in") continue;
    // Single-order, ambiguous-ID and incomplete histories cannot support a
    // churn score. Never invent an order cadence, order IDs, or $50 purchases.
    const history = verifiedHistoryByIdentity.get(customer.identityKey);
    if (!history) continue;
    const score = scoreCustomerChurn({
      customerKey: customer.identityKey,
      customerName: customer.displayName,
      history,
      now: new Date(`${today}T16:00:00.000Z`),
    });
    const draft = buildWinBackDraft({
      score,
      storeName: input.recoveryDraftIdentity.storeName,
      senderName: input.recoveryDraftIdentity.senderName,
      lastServiceLabel: input.recoveryDraftIdentity.serviceLabel,
    });
    const obligation = proposeRecoveryObligation(customer, dueDate, check.why, draft.message);
    // Prepared, never committed: the obligation reaches Mission Director as a
    // candidate, and only the operator's approval puts it on the Day Line.
    await upsertObligation(input.tenantId, input.operatorUserId, obligation);
    created += 1;
  }

  // A follow-up the pipeline completed, cancelled or moved to another day is no
  // longer this scheduled work: its board copy is closed the same way, so a
  // reschedule never leaves two copies and a finished one never lingers. Only
  // copies carrying their follow-up's id are judged; an unreadable or missing
  // follow-up is unknown, and its copy is left as it is.
  try {
    const scheduled = (
      await listPersistentOperatorObligationRecords({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
      })
    ).filter(record =>
      record.kind === "sales_follow_up" && record.status === "scheduled" && record.commercialFollowUpRef
    );
    const states = scheduled.length
      ? await listCommercialFollowUpStates(
          input.tenantId,
          scheduled.map(record => record.commercialFollowUpRef!)
        )
      : [];
    const stateById = new Map((states ?? []).map(state => [state.id, state] as const));
    for (const record of scheduled) {
      const state = stateById.get(record.commercialFollowUpRef!);
      if (!state) continue;
      const closed = closeSalesFollowUpIfMoved(record.payload, {
        status: state.status,
        accountKey: String(state.missionId),
        dueDate: followUpDueDate(state.dueAt),
      });
      if (!closed) continue;
      await upsertObligation(input.tenantId, input.operatorUserId, closed, {
        commercialFollowUpRef: record.commercialFollowUpRef,
      });
    }
  } catch (error) {
    console.warn("[ClaireProactive] sales follow-up reconciliation unavailable", error instanceof Error ? error.message : error);
  }

  if (!skipSales) {
    try {
      const due = await listOpenCommercialFollowUps(input.tenantId);
      const already = await listPersistentOperatorObligationRecords({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
      });
      for (const follow of due.slice(0, 5)) {
        const dueDate = followUpDueDate(follow.dueAt);
        if (dueDate > addDaysYmd(today, 7)) continue;
        const name = follow.accountName?.trim() || `Mission ${follow.missionId}`;
        const obligation = salesFollowUpObligation({
          accountKey: String(follow.missionId),
          accountName: name,
          dueDate,
          nextStep: follow.note,
          lastOutcome: null,
          history: [follow.note],
        });
        const existing = already.find(item => item.id === obligation.id);
        // A closed copy for this account and day is scheduled again for the
        // open follow-up now due that day when it was rescheduled away from
        // this day, or was closed for a different follow-up.
        const reopen =
          existing != null &&
          existing.commercialFollowUpRef != null &&
          CLOSED_OBLIGATION_STATUSES.has(existing.status) &&
          (existing.status === "superseded" || existing.commercialFollowUpRef !== follow.id);
        if (existing && !reopen) {
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
    warnings.push("CleanCloud freshness could not be read. That is not an empty customer list.");
  }
  if (ledgerUnreadable) {
    warnings.push("The customer book could not be read. That is not an empty customer list.");
  } else if (outreachDisposition !== "current") {
    warnings.push(
      `CleanCloud customer truth is ${outreachDisposition}. Personalized recovery outreach is withheld.`
    );
  }

  const insight = await loadSalesInsight(input.tenantId, new Date(now), timeZone).catch(() => null);
  const freshInsight = insight && surfacedSalesInsights.get(sweepKey) !== insight.observationReference ? insight : null;
  if (freshInsight) surfacedSalesInsights.set(sweepKey, freshInsight.observationReference);
  const recoveries = obligations.filter(item => item.kind === "dormant_recovery");
  const sales = obligations.filter(item =>
    item.kind === "sales_follow_up" && item.status === "scheduled"
  );
  const overload = overloadJudgment([]);
  return {
    created,
    salesArtifacts: freshInsight ? [freshInsight] : [],
    brief: [freshInsight?.speech, morningChiefOfStaffBrief({
      recoveries, sales, warnings, overload, skipSales, skipRecovery,
    })].filter(Boolean).join(" "),
    conciseBrief: conciseOperatorBoardSpeech({
      recoveries, sales, warnings, overload, skipSales, skipRecovery,
    }),
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
}): Promise<{ brief: string; conciseBrief?: string; created: number; salesArtifacts?: SalesInsightArtifact[] }> {
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
  if (/\bsales\b/.test(lower) && /\bpush(?:ing)?|why are you\b/.test(lower)) {
    const hold = await loadOperatorSalesHoldFor({ tenantId, operatorUserId });
    const today = await operatorBusinessDate(tenantId, new Date(), getDashboardTimeZone());
    return whyPushingSales(hold != null && salesHeldOn({ skipSalesUntil: hold.until }, today));
  }
  const items = await loadObligations(tenantId, operatorUserId);
  const named = items.filter(item => utteranceNamesObligation(lower, item));
  // A copy still on the board answers before one a reschedule or the pipeline closed.
  const hit = named.find(item => !CLOSED_OBLIGATION_STATUSES.has(item.status)) ?? named[0];
  return hit ? explainWhyOnToday(hit) : null;
}

export async function handleDoctrineTurn(input: {
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  today: string;
  now?: Date;
}): Promise<string | null> {
  // "No sales today" / "resume sales": dated in the business's own time zone
  // (not the dashboard zone `today` uses) and applied across every open id.
  const sales = parseSalesHoldInstruction(input.utterance);
  if (sales)
    return recordOperatorSalesHoldInstruction({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      instruction: sales,
      utterance: input.utterance,
      now: input.now ?? new Date(),
      fallbackTimeZone: getDashboardTimeZone(),
    });
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
