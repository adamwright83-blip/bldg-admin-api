/**
 * hidden_game.lost_property: unlock rules, pure. (Spec v2 §2, system map §3a.)
 *
 *   A sale opens the door. Objectives walk you through. Traction earns the ending.
 *
 * - Chapter 1 opens at the tenant's first VERIFIED sale in a territory.
 * - Chapter 2 and Chapter 3 each open after OBJECTIVES_PER_CHAPTER completed
 *   Day Line Objectives, counted from the moment the previous chapter opened.
 * - Chapter 4 is the "?" tag and never opens here.
 * - Opened chapters are permanent. Nothing here can lock one again.
 *
 * Everything is computed from ledger timestamps, so the answer does not depend
 * on when, or whether, the player opened the game. The game never writes a
 * business fact and nothing here produces one.
 */

/** Versioned. Change it only with Adam. */
export const OBJECTIVES_PER_CHAPTER = 3 as const;
export const HIDDEN_GAME_UNLOCK_RULE_VERSION = 2 as const;
/** Chapters that exist. Chapter 4 is the "?" tag. */
export const HIDDEN_GAME_PLAYABLE_CHAPTERS = 3 as const;

export type NextUnlockRequirement =
  | "first_verified_sale"
  | "complete_objectives"
  | "all_unlocked";

export type HiddenGameEligibility = {
  /** Monotonic, 0..HIDDEN_GAME_PLAYABLE_CHAPTERS. */
  unlockedChapters: number;
  /** The next chapter that can open, or null once all are open. */
  nextChapter: number | null;
  /** Objectives still needed for nextChapter. Null when the next step is a sale or nothing. */
  objectivesRemaining: number | null;
  /** Territory of the first verified sale, when there is one. */
  firstSaleTerritoryId: string | null;
  nextUnlockRequirement: NextUnlockRequirement;
  /** True only for the owner-only developer preview. Writes nothing. */
  preview: boolean;
};

/** One completed Day Line Objective, however its owning ledger records it. */
export type CompletedUnit = {
  /** Stable identity of the underlying work. Duplicates collapse to the earliest. */
  key: string;
  /** ISO timestamp from the owning ledger. */
  completedAt: string;
};

export type FirstVerifiedSale = {
  territoryId: string;
  /** ISO timestamp of the sale (order time). */
  occurredAt: string;
};

export type UnlockRecord = {
  chapter: number;
  /** ISO timestamp the chapter's condition was met. Anchors the next count. */
  openedAt: string;
  unlockedOnLocalDate: string;
};

export type ResolvedChapter = { chapter: number; openedAt: string };

function ms(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** Collapse duplicates by key to the earliest valid completion, sorted by time. */
export function dedupeUnits(units: readonly CompletedUnit[]): CompletedUnit[] {
  const earliest = new Map<string, CompletedUnit>();
  for (const unit of units) {
    if (!unit.key || !Number.isFinite(ms(unit.completedAt))) continue;
    const seen = earliest.get(unit.key);
    if (!seen || ms(unit.completedAt) < ms(seen.completedAt)) earliest.set(unit.key, unit);
  }
  return [...earliest.values()].sort(
    (a, b) => ms(a.completedAt) - ms(b.completedAt) || a.key.localeCompare(b.key)
  );
}

/**
 * Which chapters the ledgers say are open, and when each one's condition was met.
 * `persisted` is the permanent record: a chapter in it stays open even if the
 * ledgers later stop supporting it, and it anchors the count for the chapter after.
 */
export function resolveChapters(input: {
  firstSale: FirstVerifiedSale | null;
  units: readonly CompletedUnit[];
  persisted: readonly UnlockRecord[];
  /** Optional floor: objectives completed before this instant never count. */
  countFrom?: string | null;
}): ResolvedChapter[] {
  const persistedBy = new Map(input.persisted.map(row => [row.chapter, row.openedAt]));
  const floor = input.countFrom && Number.isFinite(ms(input.countFrom)) ? ms(input.countFrom) : -Infinity;
  const units = dedupeUnits(input.units).filter(unit => ms(unit.completedAt) >= floor);
  const out: ResolvedChapter[] = [];

  // Chapter 1: the first verified sale, or a permanent record of one.
  let anchor: string | null = persistedBy.get(1) ?? input.firstSale?.occurredAt ?? null;
  if (anchor === null) return out;
  out.push({ chapter: 1, openedAt: anchor });

  for (let chapter = 2; chapter <= HIDDEN_GAME_PLAYABLE_CHAPTERS; chapter += 1) {
    const kept = persistedBy.get(chapter);
    if (kept) {
      anchor = kept;
      out.push({ chapter, openedAt: kept });
      continue;
    }
    const after = ms(anchor);
    const counted = units.filter(unit => ms(unit.completedAt) > after);
    if (counted.length < OBJECTIVES_PER_CHAPTER) break;
    anchor = counted[OBJECTIVES_PER_CHAPTER - 1]!.completedAt;
    out.push({ chapter, openedAt: anchor });
  }
  return out;
}

export function projectEligibility(input: {
  resolved: readonly ResolvedChapter[];
  firstSale: FirstVerifiedSale | null;
  units: readonly CompletedUnit[];
  countFrom?: string | null;
}): HiddenGameEligibility {
  const unlocked = input.resolved.length;
  const base = {
    unlockedChapters: unlocked,
    firstSaleTerritoryId: input.firstSale?.territoryId ?? null,
    preview: false,
  };
  if (unlocked >= HIDDEN_GAME_PLAYABLE_CHAPTERS) {
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
  const anchor = ms(input.resolved[unlocked - 1]!.openedAt);
  const floor =
    input.countFrom && Number.isFinite(ms(input.countFrom)) ? ms(input.countFrom) : -Infinity;
  const counted = dedupeUnits(input.units).filter(
    unit => ms(unit.completedAt) > anchor && ms(unit.completedAt) >= floor
  ).length;
  return {
    ...base,
    nextChapter: unlocked + 1,
    objectivesRemaining: Math.max(0, OBJECTIVES_PER_CHAPTER - counted),
    nextUnlockRequirement: "complete_objectives",
  };
}

/** Preview answer: everything open, nothing recorded. */
export function previewEligibility(): HiddenGameEligibility {
  return {
    unlockedChapters: HIDDEN_GAME_PLAYABLE_CHAPTERS,
    nextChapter: null,
    objectivesRemaining: null,
    firstSaleTerritoryId: null,
    nextUnlockRequirement: "all_unlocked",
    preview: true,
  };
}

/** Chapters the ledgers support that are not yet in the permanent record. */
export function chaptersToRecord(
  resolved: readonly ResolvedChapter[],
  persisted: readonly UnlockRecord[]
): ResolvedChapter[] {
  const have = new Set(persisted.map(row => row.chapter));
  return resolved.filter(row => !have.has(row.chapter));
}

/** The preview is on only when BOTH env values match. Unset either and it is off. */
export function isPreviewOperator(input: {
  tenantId: string;
  canonicalOpenIds: readonly string[];
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
  return input.canonicalOpenIds.some(id => allowed.has(id.trim()));
}
