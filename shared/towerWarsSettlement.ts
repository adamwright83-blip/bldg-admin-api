/**
 * WEEKLY RIVALRY CONTRACT
 *
 * Charge carries across civil days within Monday–Sunday Los Angeles seasons,
 * and resets only at the next Monday boundary. Mon $40 + Tue $10 fires once.
 * Located impacts preserve each strike, removing the old aggregate saturation
 * reason for daily resets. Revenue remains authoritative business history.
 * Closed seasons are revisable projections: late/corrected evidence may change
 * their winners, never the actual payment timestamps. One season replayed in
 * isolation yields identical charge, attacks and impact identities. The legacy
 * `today` field now means current season through the requested business date.
 */
import {
  damageStateForIncomingAttacks,
  type TowerDamageState,
  type TowerWarsBuildingId,
  type TowerWarsBusinessEvent,
} from "./towerWars";
import { compileRivalrySeason, rivalryHistory, rivalrySeasonId, rivalrySides } from "./towerWarsSeasons";

/** Legacy shape retained for history renderers; new strata represent seasons. */
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
  /** Derived accessibility summary for the current season. */
  damage: TowerDamageState;
  /** Charge toward the next strike. Resets at Monday's season boundary. */
  unspentValueCents: number;
  /** Real order value booked in the season through the requested date. */
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
  /** Prior seasons, oldest first. Legacy aggregate history representation. */
  strata: ScarStratum[];
  /** Settled attacks; authoritative corrections can revise this projection. */
  settledScars: number;
  /** Business truth, unaffected by the weekly combat reset. */
  lifetime: LifetimeRevenue;
};

export type TowerWarsSettlement = {
  businessDate: string;
  buildings: Record<TowerWarsBuildingId, BuildingSettlement>;
  seasonId: string;
  sides: [TowerWarsBuildingId, TowerWarsBuildingId];
  seasons: ReturnType<typeof rivalryHistory>;
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
 * Compatibility export: a historical day is a view into its rivalry season.
 * The accumulator starts at that season's Monday, not at the selected day.
 */
export function compileDailyMatch(input: {
  businessDate: string;
  events: readonly TowerWarsBusinessEvent[];
}): Record<TowerWarsBuildingId, TodayMatch> {
  const state = compileRivalrySeason(input.events, input.businessDate).state;
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
    const seasonId = rivalrySeasonId(event.businessDate);
    const bucket = byDate.get(seasonId);
    if (bucket) bucket.push(event);
    else byDate.set(seasonId, [event]);
  }

  const settledDates = Array.from(byDate.keys())
    .filter(date => date < rivalrySeasonId(input.todayBusinessDate))
    .sort();

  // Each season compiled independently, from a zero accumulator.
  const matchesByDate = new Map<string, Record<TowerWarsBuildingId, TodayMatch>>();
  for (const [businessDate, events] of Array.from(byDate.entries())) {
    matchesByDate.set(
      businessDate,
      compileDailyMatch({ businessDate: events.reduce((date, event) => event.businessDate > date ? event.businessDate : date, businessDate), events })
    );
  }

  const todayMatches =
    matchesByDate.get(rivalrySeasonId(input.todayBusinessDate)) ??
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

  return { businessDate: input.todayBusinessDate, buildings,
    seasonId: rivalrySeasonId(input.todayBusinessDate),
    sides: rivalrySides(inRange, input.todayBusinessDate),
    seasons: rivalryHistory(inRange, input.todayBusinessDate) };
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
