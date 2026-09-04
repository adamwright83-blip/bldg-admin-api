/**
 * Projects the city's evidence into window states, and keeps them honest as
 * time passes.
 *
 * WHY THIS NEEDS A TIMER AT ALL
 *
 * An outreach ribbon is true for a bounded window and false afterwards. React
 * re-renders on state change, not on the passage of time, so a city left open on
 * a desk would keep claiming an outreach was recent hours after it stopped being
 * true — and it would go on claiming it until something unrelated happened to
 * cause a render.
 *
 * So this schedules ONE timer at the earliest moment any building's appearance
 * changes, and advances `now` when it fires. Not a poll: no interval, no
 * per-second churn, exactly one wake-up per real transition.
 */
import { useEffect, useMemo, useState } from "react";
import {
  projectBuildingVitality,
  projectCustomerVitality,
  type BuildingVitality,
} from "./lanternVitality";

export type LanternCityPayload = {
  buildings: Array<{
    buildingId: string;
    buildingName: string;
    customers: Array<{
      customerId: string;
      customerName: string;
      activeOrderCount: number | null;
      score: number | null;
      daysSinceLastOrder: number | null;
      contactedAt: string | null;
    }>;
  }>;
  unresolved: { count: number; label: string | null };
};

export type LanternVitalityResult = {
  byBuilding: Map<string, BuildingVitality>;
  unresolvedLabel: string | null;
};

export function useLanternVitality(
  payload: LanternCityPayload | undefined
): LanternVitalityResult {
  const [now, setNow] = useState(() => new Date());

  const byBuilding = useMemo(() => {
    const map = new Map<string, BuildingVitality>();
    for (const building of payload?.buildings ?? []) {
      const customers = building.customers.map(customer =>
        projectCustomerVitality(
          {
            customerId: customer.customerId,
            activeOrderCount: customer.activeOrderCount,
            score: customer.score,
            daysSinceLastOrder: customer.daysSinceLastOrder,
            contactedAt: customer.contactedAt ? new Date(customer.contactedAt) : null,
          },
          now
        )
      );
      map.set(building.buildingId, projectBuildingVitality(building.buildingId, customers));
    }
    return map;
  }, [payload, now]);

  /*
    The soonest expiry across every building. Waking once for the earliest
    transition and recomputing is correct because recomputing re-derives the next
    one — a chain of single timers rather than a timer per ribbon.
  */
  const nextChangeAt = useMemo(() => {
    let soonest: Date | null = null;
    for (const building of Array.from(byBuilding.values())) {
      if (!building.nextChangeAt) continue;
      if (!soonest || building.nextChangeAt < soonest) soonest = building.nextChangeAt;
    }
    return soonest;
  }, [byBuilding]);

  useEffect(() => {
    if (!nextChangeAt) return;
    const delay = Math.max(0, nextChangeAt.getTime() - Date.now());
    /*
      setTimeout clamps above ~24.8 days and would fire immediately, looping. No
      ribbon lives that long, but guarding costs nothing and a runaway timer in
      a page people leave open all day is an expensive thing to be wrong about.
    */
    if (delay > 2_147_483_647) return;
    const id = window.setTimeout(() => setNow(new Date()), delay);
    return () => window.clearTimeout(id);
  }, [nextChangeAt]);

  return { byBuilding, unresolvedLabel: payload?.unresolved.label ?? null };
}
