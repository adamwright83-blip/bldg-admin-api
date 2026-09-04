import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { compileTowerWarsState, type TowerWarsBuildingId, type TowerWarsBusinessEvent } from "./towerWars";

export const RIVALRY_TIME_ZONE = "America/Los_Angeles";
/** Calendar arithmetic on civil date labels, never 7*24h across DST. */
export function rivalrySeasonId(businessDate: string) {
  return format(startOfWeek(parseISO(businessDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
}
export function rivalrySeasonWindow(businessDate: string) {
  const seasonId = rivalrySeasonId(businessDate);
  const endDate = format(addDays(parseISO(seasonId), 7), "yyyy-MM-dd");
  return { seasonId, localStart: seasonId, localEnd: format(addDays(parseISO(seasonId), 6), "yyyy-MM-dd"),
    startUtc: fromZonedTime(`${seasonId}T00:00:00`, RIVALRY_TIME_ZONE),
    endExclusiveUtc: fromZonedTime(`${endDate}T00:00:00`, RIVALRY_TIME_ZONE) };
}
export function compileRivalrySeason(events: readonly TowerWarsBusinessEvent[], businessDate: string) {
  const window = rivalrySeasonWindow(businessDate);
  const ledger = events.filter(event => rivalrySeasonId(event.businessDate) === window.seasonId && event.businessDate <= businessDate);
  const state = compileTowerWarsState(ledger);
  const opus = state.buildings.opus_la.revenueCents;
  const cpe = state.buildings.century_park_east.revenueCents;
  const winner: TowerWarsBuildingId | null = opus === cpe ? null : opus > cpe ? "opus_la" : "century_park_east";
  return { ...window, state, ledger, result: winner ? "WIN" as const : "DRAW" as const, winner,
    loser: winner ? (winner === "opus_la" ? "century_park_east" : "opus_la") as TowerWarsBuildingId : null };
}
export function rivalryHistory(events: readonly TowerWarsBusinessEvent[], today: string) {
  const current = rivalrySeasonId(today);
  const keys = Array.from(new Set(events.filter(e => e.businessDate <= today).map(e => rivalrySeasonId(e.businessDate)))).sort();
  if (!keys.includes(current)) keys.push(current);
  return keys.map(key => {
    const window = rivalrySeasonWindow(key);
    const result = compileRivalrySeason(events, key === current ? today : window.localEnd);
    return { ...result, status: key < current ? "closed" as const : "current" as const };
  });
}
/** Prior non-draw champion is retained through draws; never consult current
 * revenue when assigning sides. Late authoritative corrections recompute this. */
export function rivalrySides(events: readonly TowerWarsBusinessEvent[], today: string): [TowerWarsBuildingId, TowerWarsBuildingId] {
  const prior = rivalryHistory(events, today).filter(s => s.status === "closed" && s.winner).at(-1);
  return prior?.winner && prior.loser ? [prior.loser, prior.winner] : ["century_park_east", "opus_la"];
}
