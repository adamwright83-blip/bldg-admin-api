/**
 * Decay forecast — "this territory goes quiet in N days unless one order lands."
 *
 * Pure cadence arithmetic over the same `CustomerCadence` the lanterns already
 * use, run forward through `deriveTerritoryVisualState`. It predicts nothing
 * about people; it only asks: if no order arrives, on which business date does
 * the territory's visual state get worse?
 *
 * Rules:
 * - Sparse-cadence customers never move. We cannot say when someone with no
 *   measured rhythm will dim, so we do not.
 * - A forecast is always "unless one order lands". One real order from any
 *   dimming or active customer resets that customer, which is the only
 *   honest defence the forecast may name.
 * - Horizon is capped. Beyond it the answer is "not soon", not a date.
 * - Presentation only. Nothing here is stored.
 */
import {
  deriveTerritoryVisualState,
  type TerritoryCustomerMix,
  type TerritoryVisualState,
} from "./lanternTerritoryVisualState";
import type { CustomerCadence, LanternState } from "./lanternCity";

export const DECAY_FORECAST_HORIZON_DAYS = 45;

/** Mirrors `inferCustomerCadence`: ratio of days-since-last to expected cadence. */
const DIMMING_RATIO = 1.25;
const DARK_RATIO = 2.5;

const SEVERITY: Record<TerritoryVisualState, number> = {
  healthy: 0,
  at_risk: 1,
  cooling: 2,
  overgrown: 3,
  infested: 4,
  closed_construction: 5,
  lost_ground: 6,
  locked_opportunity: 0,
};

export type DecayForecast = {
  territoryId: string;
  currentState: TerritoryVisualState;
  /** The worse state the territory reaches first, or null if none inside the horizon. */
  nextState: TerritoryVisualState | null;
  /** Whole business days from today until `nextState`. Null when `nextState` is null. */
  daysUntil: number | null;
  /** Always 1. One real order resets one customer. Stated so copy cannot inflate it. */
  ordersToHold: 1;
  /** Customers whose reorder would push the date out, most urgent first. Identity keys only. */
  holdCandidates: string[];
};

export type DecayForecastCustomer = {
  identityKey: string;
  cadence: CustomerCadence;
};

function stateAfter(cadence: CustomerCadence, daysAhead: number): LanternState {
  if (cadence.confidence !== "measured" || cadence.expectedCadenceDays == null)
    return cadence.state;
  const ratio =
    (cadence.daysSinceLastOrder + daysAhead) / cadence.expectedCadenceDays;
  return ratio <= DIMMING_RATIO ? "active" : ratio <= DARK_RATIO ? "dimming" : "dark";
}

function mixAt(
  customers: DecayForecastCustomer[],
  daysAhead: number,
  base: Omit<TerritoryCustomerMix, "active" | "dimming" | "dark">
): TerritoryCustomerMix {
  const mix = { ...base, active: 0, dimming: 0, dark: 0 };
  for (const customer of customers) mix[stateAfter(customer.cadence, daysAhead)]++;
  return mix;
}

export function forecastTerritoryDecay(input: {
  territoryId: string;
  customers: DecayForecastCustomer[];
  occupancy: Omit<TerritoryCustomerMix, "active" | "dimming" | "dark" | "territoryId">;
  horizonDays?: number;
}): DecayForecast {
  const horizon = input.horizonDays ?? DECAY_FORECAST_HORIZON_DAYS;
  const base = { territoryId: input.territoryId, ...input.occupancy };
  const currentState = deriveTerritoryVisualState(mixAt(input.customers, 0, base));

  let nextState: TerritoryVisualState | null = null;
  let daysUntil: number | null = null;
  for (let day = 1; day <= horizon; day++) {
    const state = deriveTerritoryVisualState(mixAt(input.customers, day, base));
    if (SEVERITY[state] > SEVERITY[currentState]) {
      nextState = state;
      daysUntil = day;
      break;
    }
  }

  const holdCandidates = input.customers
    .filter(c => c.cadence.confidence === "measured" && c.cadence.state !== "dark")
    .filter(c => daysUntil == null || stateAfter(c.cadence, daysUntil) !== c.cadence.state)
    .sort((a, b) => b.cadence.daysSinceLastOrder - a.cadence.daysSinceLastOrder)
    .map(c => c.identityKey);

  return {
    territoryId: input.territoryId,
    currentState,
    nextState,
    daysUntil,
    ordersToHold: 1,
    holdCandidates,
  };
}

/** House voice. Sparse, no blame, never a promise. */
export function decayForecastLine(forecast: DecayForecast): string | null {
  if (forecast.nextState == null || forecast.daysUntil == null) return null;
  const unit = forecast.daysUntil === 1 ? "day" : "days";
  return `Goes quiet in ${forecast.daysUntil} ${unit} unless one order lands.`;
}
