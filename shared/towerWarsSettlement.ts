/**
 * TOWER WARS SETTLEMENT — a legible match today, permanent history underneath.
 *
 * Tower Wars had no second act. `damageStateForIncomingAttacks` reads a
 * monotonic `incomingAttackCount`, nothing anywhere decays or repairs it, and
 * four attacks reach `critical` permanently. Given real order volume both
 * buildings converge on maximum damage and the visual language stops carrying
 * information.
 *
 * THE DAILY COMBAT CONTRACT
 *
 * Tower Wars is a battle for TODAY. That is a locked rule, and this module
 * implements it exactly:
 *
 *   - today's scoreboard begins at zero;
 *   - each building's attack accumulator begins at zero;
 *   - today's real orders add today's real order value;
 *   - every TOWER_WARS_ATTACK_THRESHOLD_CENTS crossed emits today's attack;
 *   - the remainder exists only inside that business day's match;
 *   - at the next business-day boundary the match and the accumulator reset;
 *   - the completed day's attacks settle into permanent strata;
 *   - the underlying real revenue is never discarded.
 *
 * So each business date is folded INDEPENDENTLY, from a fresh
 * `initialTowerWarsState()`. Yesterday's unspent charge cannot fire today's
 * shot:
 *
 *   Day 1 — $40 of real OPUS revenue. 4000/5000 toward a strike. No attack.
 *   Day 2 — $10 of real OPUS revenue. 1000/5000 toward a strike. No attack,
 *           even though 4000 + 1000 reaches the threshold, because day 2's
 *           accumulator started at zero.
 *
 * Resetting theatrical ammunition does not destroy revenue. The $40 remains
 * authoritative business history and is reported in `lifetime` below — it
 * simply never becomes a projectile in a later day's match. Anything else
 * would make today's spectacle partly caused by yesterday's business and
 * destroy the legibility of TODAY.
 *
 * The invariant that guarantees it: replaying one business date in isolation
 * reproduces exactly that date's attacks and final TODAY damage, regardless of
 * any preceding day's remainder.
 */
import {
  compileTowerWarsState,
  damageStateForIncomingAttacks,
  type TowerDamageState,
  type TowerWarsBuildingId,
  type TowerWarsBusinessEvent,
} from "./towerWars";

/** One settled day of history on one building. Never rewritten, never decays. */
export type ScarStratum = {
  businessDate: string;
  /** Attacks this building absorbed on that day, in that day's own match. */
  incomingAttacks: number;
  /** What the facade looked like at the close of that day's match. */
  damageAtSettlement: TowerDamageState;
};

export type TodayMatch = {
  businessDate: string;
  incomingAttacks: number;
  outgoingAttacks: number;
  /** Reflects TODAY only — this is what makes the live match legible. */
  damage: TowerDamageState;
  /** Charge toward the next strike. Expires at the day boundary by design. */
  unspentValueCents: number;
  /** Real order value booked today. */
  revenueCents: number;
  orderCount: number;
};

/**
 * Real business history, kept deliberately separate from combat. Revenue and
 * orders accumulate across every day in range and are never reset — only the
 * theatrical accumulator is.
 */
export type LifetimeRevenue = {
  revenueCents: number;
  orderCount: number;
};

export type BuildingSettlement = {
  buildingId: TowerWarsBuildingId;
  today: TodayMatch;
  /** Prior days, oldest first. The building's permanent architectural record. */
  strata: ScarStratum[];
  /** Total attacks absorbed across all settled days. Only ever grows. */
  settledScars: number;
  /** Business truth, unaffected by the daily combat reset. */
  lifetime: LifetimeRevenue;
};

export type TowerWarsSettlement = {
  businessDate: string;
  buildings: Record<TowerWarsBuildingId, BuildingSettlement>;
};

const BUILDING_IDS: TowerWarsBuildingId[] = ["opus_la", "century_park_east"];

function emptyToday(businessDate: string): TodayMatch {
  return {
    businessDate,
    incomingAttacks: 0,
    outgoingAttacks: 0,
    damage: "pristine",
    unspentValueCents: 0,
    revenueCents: 0,
    orderCount: 0,
  };
}

/**
 * Compile ONE business day's match in isolation, from a zero accumulator.
 *
 * This is the unit the whole contract rests on: it takes only that day's
 * events, so there is no parameter through which a previous day's remainder
 * could reach it.
 */
export function compileDailyMatch(input: {
  businessDate: string;
  events: readonly TowerWarsBusinessEvent[];
}): Record<TowerWarsBuildingId, TodayMatch> {
  const sameDay = input.events.filter(
    event => event.businessDate === input.businessDate
  );
  const state = compileTowerWarsState(sameDay);
  const result = {} as Record<TowerWarsBuildingId, TodayMatch>;
  for (const buildingId of BUILDING_IDS) {
    const building = state.buildings[buildingId];
    const incomingAttacks = state.attacks.filter(
      attack => attack.defenderBuildingId === buildingId
    ).length;
    const outgoingAttacks = state.attacks.filter(
      attack => attack.attackerBuildingId === buildingId
    ).length;
    result[buildingId] = {
      businessDate: input.businessDate,
      incomingAttacks,
      outgoingAttacks,
      damage: damageStateForIncomingAttacks(incomingAttacks),
      unspentValueCents: building.unspentValueCents,
      revenueCents: building.revenueCents,
      orderCount: building.orderCount,
    };
  }
  return result;
}

/**
 * Settle a full event history into today's match plus permanent strata.
 *
 * `todayBusinessDate` decides the boundary. Events dated after it are ignored
 * rather than folded early — a settlement must never depend on data from the
 * future of the date it claims to describe.
 */
export function settleTowerWars(input: {
  events: readonly TowerWarsBusinessEvent[];
  todayBusinessDate: string;
}): TowerWarsSettlement {
  const inRange = input.events.filter(
    event => event.businessDate <= input.todayBusinessDate
  );

  const byDate = new Map<string, TowerWarsBusinessEvent[]>();
  for (const event of inRange) {
    const bucket = byDate.get(event.businessDate);
    if (bucket) bucket.push(event);
    else byDate.set(event.businessDate, [event]);
  }

  const settledDates = Array.from(byDate.keys())
    .filter(date => date < input.todayBusinessDate)
    .sort();

  // Each day compiled independently, from a zero accumulator.
  const matchesByDate = new Map<string, Record<TowerWarsBuildingId, TodayMatch>>();
  for (const [businessDate, events] of Array.from(byDate.entries())) {
    matchesByDate.set(
      businessDate,
      compileDailyMatch({ businessDate, events })
    );
  }

  const todayMatches =
    matchesByDate.get(input.todayBusinessDate) ??
    ({
      opus_la: emptyToday(input.todayBusinessDate),
      century_park_east: emptyToday(input.todayBusinessDate),
    } as Record<TowerWarsBuildingId, TodayMatch>);

  const buildings = {} as Record<TowerWarsBuildingId, BuildingSettlement>;
  for (const buildingId of BUILDING_IDS) {
    const strata: ScarStratum[] = settledDates
      .map(businessDate => {
        const match = matchesByDate.get(businessDate)![buildingId];
        return {
          businessDate,
          incomingAttacks: match.incomingAttacks,
          damageAtSettlement: match.damage,
        };
      })
      // A day on which a building absorbed nothing leaves no mark on it.
      .filter(stratum => stratum.incomingAttacks > 0);

    // Revenue is business truth and survives every combat reset.
    let revenueCents = 0;
    let orderCount = 0;
    for (const match of Array.from(matchesByDate.values())) {
      revenueCents += match[buildingId].revenueCents;
      orderCount += match[buildingId].orderCount;
    }

    buildings[buildingId] = {
      buildingId,
      today: todayMatches[buildingId],
      strata,
      settledScars: strata.reduce(
        (total, stratum) => total + stratum.incomingAttacks,
        0
      ),
      lifetime: { revenueCents, orderCount },
    };
  }

  return { businessDate: input.todayBusinessDate, buildings };
}

/**
 * Total attacks a building has ever absorbed, settled plus today. Provided so
 * callers never have to reach for the old monotonic `incomingAttackCount` to
 * answer "how much has this building been through in total".
 */
export function lifetimeIncomingAttacks(
  settlement: BuildingSettlement
): number {
  return settlement.settledScars + settlement.today.incomingAttacks;
}
