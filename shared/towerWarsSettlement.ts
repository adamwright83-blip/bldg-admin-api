/**
 * TOWER WARS SETTLEMENT — a legible match today, permanent history underneath.
 *
 * Tower Wars had no second act. `damageStateForIncomingAttacks` reads a
 * monotonic `incomingAttackCount`, nothing anywhere decays or repairs it, and
 * four attacks reach `critical` permanently. Given real order volume both
 * buildings converge on maximum damage and the visual language stops carrying
 * information.
 *
 * The fix follows the temporal contract Level 4 already uses (a daily match
 * that settles at close of day and starts tomorrow from the settled position),
 * with the difference that a settled Tower Wars day becomes ARCHITECTURE:
 *
 *   TODAY    — a fresh, legible match. Damage reflects only today's attacks.
 *   SETTLED  — every prior day, kept forever as a stratum positioned in time.
 *
 * A facade therefore reads as an arena and an ancient city at once: today's
 * fight is legible because it is not competing with months of accumulated
 * damage, and the months are still there, in order, underneath it.
 *
 * WHY THE FOLD STAYS CONTINUOUS
 *
 * `applyTowerWarsEvent` carries `unspentValueCents` — revenue that has not yet
 * reached the attack threshold. Folding each day independently would discard
 * that remainder at every midnight, so a $60 order under a $75 threshold would
 * simply vanish from the war. That is destroying real revenue to make a
 * presentation tidier.
 *
 * So this module folds ALL events once, exactly as the live compiler does, and
 * only ATTRIBUTES the resulting attacks to the business date of the event that
 * triggered them. Revenue accounting is untouched; the settlement is a lens on
 * it. `cumulative` is returned so callers can assert that equivalence.
 */
import {
  applyTowerWarsEvent,
  compareTowerWarsEvents,
  damageStateForIncomingAttacks,
  initialTowerWarsState,
  type TowerDamageState,
  type TowerWarsBattleState,
  type TowerWarsBuildingId,
  type TowerWarsBusinessEvent,
} from "./towerWars";

/** One settled day of history on one building. Never rewritten, never decays. */
export type ScarStratum = {
  businessDate: string;
  /** Attacks this building absorbed on that day. */
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
};

export type BuildingSettlement = {
  buildingId: TowerWarsBuildingId;
  today: TodayMatch;
  /** Prior days, oldest first. The building's permanent architectural record. */
  strata: ScarStratum[];
  /** Total attacks absorbed across all settled days. Only ever grows. */
  settledScars: number;
};

export type TowerWarsSettlement = {
  businessDate: string;
  buildings: Record<TowerWarsBuildingId, BuildingSettlement>;
  /**
   * The continuous fold, identical to `compileTowerWarsState` over the same
   * events. Exposed so revenue equivalence is checkable rather than asserted.
   */
  cumulative: TowerWarsBattleState;
};

const BUILDING_IDS: TowerWarsBuildingId[] = ["opus_la", "century_park_east"];

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
  const ordered = [...input.events]
    .filter(event => event.businessDate <= input.todayBusinessDate)
    .sort(compareTowerWarsEvents);

  // One continuous fold — unspent value carries across midnight, so no real
  // revenue is lost to the day boundary.
  const cumulative = ordered.reduce(applyTowerWarsEvent, initialTowerWarsState());

  const businessDateByEventId = new Map(
    ordered.map(event => [event.eventId, event.businessDate])
  );

  // date -> building -> counts
  const incoming = new Map<string, Map<TowerWarsBuildingId, number>>();
  const outgoing = new Map<string, Map<TowerWarsBuildingId, number>>();
  const bump = (
    table: Map<string, Map<TowerWarsBuildingId, number>>,
    date: string,
    building: TowerWarsBuildingId
  ) => {
    const row = table.get(date) ?? new Map<TowerWarsBuildingId, number>();
    row.set(building, (row.get(building) ?? 0) + 1);
    table.set(date, row);
  };

  for (const attack of cumulative.attacks) {
    const date = businessDateByEventId.get(attack.triggeringEventId);
    if (!date) continue;
    bump(incoming, date, attack.defenderBuildingId);
    bump(outgoing, date, attack.attackerBuildingId);
  }

  const settledDates = Array.from(
    new Set(ordered.map(event => event.businessDate))
  )
    .filter(date => date < input.todayBusinessDate)
    .sort();

  const buildings = {} as Record<TowerWarsBuildingId, BuildingSettlement>;
  for (const buildingId of BUILDING_IDS) {
    const strata: ScarStratum[] = settledDates
      .map(businessDate => {
        const incomingAttacks = incoming.get(businessDate)?.get(buildingId) ?? 0;
        return {
          businessDate,
          incomingAttacks,
          damageAtSettlement: damageStateForIncomingAttacks(incomingAttacks),
        };
      })
      // A day on which a building absorbed nothing leaves no mark on it.
      .filter(stratum => stratum.incomingAttacks > 0);

    const todayIncoming =
      incoming.get(input.todayBusinessDate)?.get(buildingId) ?? 0;
    const todayOutgoing =
      outgoing.get(input.todayBusinessDate)?.get(buildingId) ?? 0;

    buildings[buildingId] = {
      buildingId,
      today: {
        businessDate: input.todayBusinessDate,
        incomingAttacks: todayIncoming,
        outgoingAttacks: todayOutgoing,
        damage: damageStateForIncomingAttacks(todayIncoming),
      },
      strata,
      settledScars: strata.reduce(
        (total, stratum) => total + stratum.incomingAttacks,
        0
      ),
    };
  }

  return { businessDate: input.todayBusinessDate, buildings, cumulative };
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
