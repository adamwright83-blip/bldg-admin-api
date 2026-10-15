/**
 * hidden_game.lost_property unlock read. Spec v2 §2 / system map §3a.
 *
 * A sale opens Chapter 1. Three eligible completed Day Line Objectives open
 * Chapter 2, counted from that sale. Three more open Chapter 3, counted from
 * Chapter 2. Chapter 4 does not open. This module writes nothing.
 */
import { OBJECTIVE_EXECUTION_TYPES } from "./objectiveExecution";
import { isDayLineCancelled, readDayLineOverlay } from "./goldlineDayLine";
import { readOperatorMissionMetadata } from "./claireWorkdayCommand";
import { classifyTerritory } from "./lanternTerritories";

export const LOST_PROPERTY_OBJECTIVES_PER_CHAPTER = 3 as const;
export const LOST_PROPERTY_UNLOCK_RULE_VERSION = 2 as const;
export const LOST_PROPERTY_PLAYABLE_CHAPTERS = 3 as const;

/** Communication and presentation events. None of these is a sale or an Objective completion. */
export const LOST_PROPERTY_NON_UNLOCK_EVIDENCE = [
  "message_draft",
  "message_scheduled",
  "message_sent",
  "message_reply",
  "animation",
  "lantern_city_opened",
  "campaign_run",
] as const;

export type LostPropertyNonUnlockEvidence = (typeof LOST_PROPERTY_NON_UNLOCK_EVIDENCE)[number];

export type LostPropertyNextRequirement =
  | "first_verified_sale"
  | "complete_objectives"
  | "all_unlocked";

export type FirstVerifiedSale = {
  territoryId: string;
  /** ISO time the paid order occurred. Not ingestion time and not read time. */
  occurredAt: string;
  eventKey: string;
};

export type CompletedUnit = {
  /** Stable work identity. Replays of the same key collapse to the earliest completion. */
  key: string;
  /** ISO completion time from the owning ledger. */
  completedAt: string;
};

export type UnlockRecord = {
  chapter: number;
  openedAt: string;
};

export type ResolvedChapter = {
  chapter: 1 | 2 | 3;
  openedAt: string;
};

export type LostPropertyUnlockRead = {
  ruleVersion: typeof LOST_PROPERTY_UNLOCK_RULE_VERSION;
  objectivesPerChapter: typeof LOST_PROPERTY_OBJECTIVES_PER_CHAPTER;
  unlockedChapters: 0 | 1 | 2 | 3;
  nextChapter: 1 | 2 | 3 | null;
  objectivesRemaining: number | null;
  firstSaleTerritoryId: string | null;
  firstSaleOccurredAt: string | null;
  firstSaleEventKey: string | null;
  nextUnlockRequirement: LostPropertyNextRequirement;
  /** Owner preview. It is a read flag. It is not a stored unlock. */
  preview: boolean;
  chapters: ResolvedChapter[];
  objectiveCounts: { afterChapter1: number; afterChapter2: number };
};

export type AdmittedPaidOrder = {
  tenantId: string;
  eventKey: string;
  occurredAt: string;
  /** Present so callers can prove it is not the sale time. Never read as occurredAt. */
  ingestedAt?: string | null;
  cents: number;
  customerIdentityKey: string | null;
};

export type CustomerTerritoryPlacement = {
  tenantId: string;
  customerIdentityKey: string;
  geocodeStatus: string;
  latitude: number | null;
  longitude: number | null;
};

export type LostPropertyOperatorScope = {
  tenantId: string;
  canonicalOperatorId: string;
  actorIds: readonly string[];
};

export type GoalCycleObjectiveEvidence = {
  tenantId: string;
  canonicalOperatorId: string;
  id: string;
  executionType: string | null;
  status: string;
  actionTargetType: string | null;
  actionTargetId: string | null;
};

export type GoalCycleActionEvidence = {
  tenantId: string;
  objectiveId: string;
  observedAt: string;
  /** Row insert time. Completion counting must not use it. */
  createdAt: string;
  impactClass: string;
  epistemicStatus: string;
};

export type DayDirectorCommitmentEvidence = {
  tenantId: string;
  actorId: string;
  id: string;
  status: string;
  completedAt: string | null;
  metadata: unknown;
};

export type IgnoredActivityEvidence = {
  tenantId: string;
  kind: LostPropertyNonUnlockEvidence;
  id: string;
  at: string | null;
};

const ELIGIBLE_EXECUTION = new Set<string>(OBJECTIVE_EXECUTION_TYPES);
const ELIGIBLE_OBJECTIVE_STATUS = new Set(["action_executed", "completed"]);

export function isRejectedUnlockEvidence(kind: string): boolean {
  return (LOST_PROPERTY_NON_UNLOCK_EVIDENCE as readonly string[]).includes(kind);
}

/** Paid-order ledger event keys only. Excluded CleanCloud twins carry extra segments. */
export function isLedgerPaidOrderEventKey(eventKey: string): boolean {
  return /^order:[0-9]+$/.test(eventKey) || /^cleancloud:[^:]+$/.test(eventKey);
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export function territoryIdForPlacement(
  placement: CustomerTerritoryPlacement
): string | null {
  if (placement.geocodeStatus !== "success") return null;
  if (placement.latitude == null || placement.longitude == null) return null;
  if (!Number.isFinite(placement.latitude) || !Number.isFinite(placement.longitude)) return null;
  try {
    return classifyTerritory(placement.latitude, placement.longitude)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Earliest admitted paid order that sits in a territory.
 * Zero cents, another tenant, a failed geocode, and a replay of the same
 * event key do not create a second sale.
 */
export function selectFirstVerifiedTerritorialSale(input: {
  tenantId: string;
  orders: readonly AdmittedPaidOrder[];
  placements: readonly CustomerTerritoryPlacement[];
}): FirstVerifiedSale | null {
  const tenantId = input.tenantId.trim();
  if (!tenantId) return null;
  const territoryByCustomer = new Map<string, string | null>();
  for (const placement of input.placements) {
    if (placement.tenantId !== tenantId) continue;
    const territory = territoryIdForPlacement(placement);
    const existing = territoryByCustomer.get(placement.customerIdentityKey);
    if (existing === undefined) territoryByCustomer.set(placement.customerIdentityKey, territory);
    else if (existing !== territory) territoryByCustomer.set(placement.customerIdentityKey, null);
  }

  const byEvent = new Map<string, FirstVerifiedSale>();
  for (const order of input.orders) {
    if (order.tenantId !== tenantId) continue;
    if (!isLedgerPaidOrderEventKey(order.eventKey)) continue;
    if (!Number.isSafeInteger(order.cents) || order.cents <= 0) continue;
    if (instant(order.occurredAt) === null) continue;
    if (!order.customerIdentityKey) continue;
    const territoryId = territoryByCustomer.get(order.customerIdentityKey);
    if (!territoryId) continue;
    const candidate: FirstVerifiedSale = {
      territoryId,
      occurredAt: order.occurredAt,
      eventKey: order.eventKey,
    };
    const existing = byEvent.get(order.eventKey);
    if (!existing || instant(candidate.occurredAt)! < instant(existing.occurredAt)!) {
      byEvent.set(order.eventKey, candidate);
    }
  }

  let best: FirstVerifiedSale | null = null;
  for (const sale of byEvent.values()) {
    if (
      !best ||
      instant(sale.occurredAt)! < instant(best.occurredAt)! ||
      (instant(sale.occurredAt) === instant(best.occurredAt) && sale.eventKey < best.eventKey)
    ) {
      best = sale;
    }
  }
  return best;
}

export function dedupeCompletedUnits(units: readonly CompletedUnit[]): CompletedUnit[] {
  const earliest = new Map<string, CompletedUnit>();
  for (const unit of units) {
    if (!unit.key || instant(unit.completedAt) === null) continue;
    const seen = earliest.get(unit.key);
    if (!seen || instant(unit.completedAt)! < instant(seen.completedAt)!) earliest.set(unit.key, unit);
  }
  return [...earliest.values()].sort(
    (a, b) => instant(a.completedAt)! - instant(b.completedAt)! || a.key.localeCompare(b.key)
  );
}

function objectiveDedupeKey(row: GoalCycleObjectiveEvidence): string {
  if (row.actionTargetType === "commitment" && row.actionTargetId?.trim()) {
    return `commitment:${row.actionTargetId.trim()}`;
  }
  return `objective:${row.id}`;
}

function earliestVerifiedAction(
  objectiveId: string,
  tenantId: string,
  outcomes: readonly GoalCycleActionEvidence[]
): string | null {
  let best: string | null = null;
  for (const outcome of outcomes) {
    if (outcome.tenantId !== tenantId || outcome.objectiveId !== objectiveId) continue;
    if (outcome.impactClass !== "action_verification" || outcome.epistemicStatus !== "verified") continue;
    if (instant(outcome.observedAt) === null) continue;
    if (!best || instant(outcome.observedAt)! < instant(best)!) best = outcome.observedAt;
  }
  return best;
}

function commitmentCounts(
  row: DayDirectorCommitmentEvidence,
  scope: LostPropertyOperatorScope
): boolean {
  if (row.tenantId !== scope.tenantId) return false;
  if (!scope.actorIds.includes(row.actorId)) return false;
  if (row.status !== "completed" || instant(row.completedAt) === null) return false;
  const metadata =
    row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;
  if (metadata?.hiddenFromDayPlan === true) return false;
  if (isDayLineCancelled(readDayLineOverlay(row.metadata))) return false;
  return readOperatorMissionMetadata(row.metadata) !== null;
}

/**
 * Eligible Day Line Objective completions for one operator.
 * Campaign-run rows, message lifecycle rows, animations, and opening Lantern
 * City are ignored. A commitment and the objective that targets it are one unit.
 */
export function collectEligibleObjectiveUnits(
  scope: LostPropertyOperatorScope,
  input: {
    objectives?: readonly GoalCycleObjectiveEvidence[];
    outcomes?: readonly GoalCycleActionEvidence[];
    commitments?: readonly DayDirectorCommitmentEvidence[];
    ignored?: readonly IgnoredActivityEvidence[];
  }
): CompletedUnit[] {
  const tenantId = scope.tenantId.trim();
  const operatorId = scope.canonicalOperatorId.trim();
  if (!tenantId || !operatorId) return [];
  const actorIds = [...new Set(scope.actorIds.map(id => id.trim()).filter(Boolean))];
  const normalized: LostPropertyOperatorScope = { tenantId, canonicalOperatorId: operatorId, actorIds };
  const units: CompletedUnit[] = [];
  for (const row of input.objectives ?? []) {
    if (row.tenantId !== tenantId || row.canonicalOperatorId !== operatorId) continue;
    if (!row.executionType || !ELIGIBLE_EXECUTION.has(row.executionType)) continue;
    if (!ELIGIBLE_OBJECTIVE_STATUS.has(row.status)) continue;
    const completedAt = earliestVerifiedAction(row.id, tenantId, input.outcomes ?? []);
    if (!completedAt) continue;
    units.push({ key: objectiveDedupeKey(row), completedAt });
  }
  for (const row of input.commitments ?? []) {
    if (!commitmentCounts(row, normalized) || !row.completedAt) continue;
    units.push({ key: `commitment:${row.id}`, completedAt: row.completedAt });
  }
  for (const row of input.ignored ?? []) {
    if (isRejectedUnlockEvidence(row.kind)) continue;
  }
  return dedupeCompletedUnits(units);
}

export function resolveLostPropertyChapters(input: {
  firstSale: FirstVerifiedSale | null;
  units: readonly CompletedUnit[];
  /** Optional permanence records. The production read has no table to supply these. */
  persisted?: readonly UnlockRecord[];
}): ResolvedChapter[] {
  const persistedBy = new Map<number, string>();
  for (const row of input.persisted ?? []) {
    if (row.chapter >= 1 && row.chapter <= LOST_PROPERTY_PLAYABLE_CHAPTERS && instant(row.openedAt) !== null) {
      persistedBy.set(row.chapter, row.openedAt);
    }
  }
  const units = dedupeCompletedUnits(input.units);
  const out: ResolvedChapter[] = [];
  const initial = persistedBy.get(1) ?? input.firstSale?.occurredAt ?? null;
  if (initial === null || instant(initial) === null) return out;
  let openedAt: string = initial;
  out.push({ chapter: 1, openedAt });
  for (let chapter = 2; chapter <= LOST_PROPERTY_PLAYABLE_CHAPTERS; chapter += 1) {
    const kept = persistedBy.get(chapter);
    if (kept) {
      openedAt = kept;
      out.push({ chapter: chapter as 2 | 3, openedAt });
      continue;
    }
    const after = instant(openedAt);
    if (after === null) break;
    const counted = units.filter(unit => {
      const completed = instant(unit.completedAt);
      return completed !== null && completed > after;
    });
    const next = counted[LOST_PROPERTY_OBJECTIVES_PER_CHAPTER - 1]?.completedAt;
    if (!next) break;
    openedAt = next;
    out.push({ chapter: chapter as 2 | 3, openedAt });
  }
  return out;
}

function countAfter(units: readonly CompletedUnit[], openedAt: string | null): number {
  const anchor = instant(openedAt);
  if (anchor === null) return 0;
  return dedupeCompletedUnits(units).filter(unit => instant(unit.completedAt)! > anchor).length;
}

export function projectLostPropertyUnlock(input: {
  firstSale: FirstVerifiedSale | null;
  units: readonly CompletedUnit[];
  persisted?: readonly UnlockRecord[];
}): LostPropertyUnlockRead {
  const chapters = resolveLostPropertyChapters(input);
  const unlocked = chapters.length as 0 | 1 | 2 | 3;
  const afterChapter1 = countAfter(input.units, chapters[0]?.openedAt ?? null);
  const afterChapter2 = countAfter(input.units, chapters[1]?.openedAt ?? null);
  const base = {
    ruleVersion: LOST_PROPERTY_UNLOCK_RULE_VERSION,
    objectivesPerChapter: LOST_PROPERTY_OBJECTIVES_PER_CHAPTER,
    unlockedChapters: unlocked,
    firstSaleTerritoryId: input.firstSale?.territoryId ?? null,
    firstSaleOccurredAt: input.firstSale?.occurredAt ?? null,
    firstSaleEventKey: input.firstSale?.eventKey ?? null,
    preview: false as const,
    chapters,
    objectiveCounts: { afterChapter1, afterChapter2 },
  };
  if (unlocked >= LOST_PROPERTY_PLAYABLE_CHAPTERS) {
    return {
      ...base,
      nextChapter: null,
      objectivesRemaining: null,
      nextUnlockRequirement: "all_unlocked",
    };
  }
  if (unlocked === 0) {
    return {
      ...base,
      nextChapter: 1,
      objectivesRemaining: null,
      nextUnlockRequirement: "first_verified_sale",
    };
  }
  const counted = countAfter(input.units, chapters[unlocked - 1]!.openedAt);
  return {
    ...base,
    nextChapter: (unlocked + 1) as 2 | 3,
    objectivesRemaining: Math.max(0, LOST_PROPERTY_OBJECTIVES_PER_CHAPTER - counted),
    nextUnlockRequirement: "complete_objectives",
  };
}

export function previewLostPropertyUnlock(): LostPropertyUnlockRead {
  return {
    ruleVersion: LOST_PROPERTY_UNLOCK_RULE_VERSION,
    objectivesPerChapter: LOST_PROPERTY_OBJECTIVES_PER_CHAPTER,
    unlockedChapters: LOST_PROPERTY_PLAYABLE_CHAPTERS,
    nextChapter: null,
    objectivesRemaining: null,
    firstSaleTerritoryId: null,
    firstSaleOccurredAt: null,
    firstSaleEventKey: null,
    nextUnlockRequirement: "all_unlocked",
    preview: true,
    chapters: [],
    objectiveCounts: { afterChapter1: 0, afterChapter2: 0 },
  };
}

export function isLostPropertyPreview(input: {
  tenantId: string;
  operatorOpenIds: readonly string[];
  envOpenIds: string | undefined;
  envTenantId: string | undefined;
}): boolean {
  const tenant = input.envTenantId?.trim();
  const allowed = new Set(
    (input.envOpenIds ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
  if (!tenant || allowed.size === 0) return false;
  if (input.tenantId.trim() !== tenant) return false;
  return input.operatorOpenIds.some(id => allowed.has(id.trim()));
}
