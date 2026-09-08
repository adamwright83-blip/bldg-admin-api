/**
 * Territory VISUAL state — presentation only.
 *
 * Derived deterministically from real customer mix + conquest occupancy for a
 * business date. Never mutates CRM facts. Thresholds are self-relative per
 * territory (ratios over that territory's customers), not universal day counts.
 */

export type TerritoryVisualState =
  | "healthy"
  | "at_risk"
  | "cooling"
  | "overgrown"
  | "infested"
  | "closed_construction"
  | "lost_ground"
  | "locked_opportunity";

export type TerritoryCustomerMix = {
  territoryId: string;
  active: number;
  dimming: number;
  dark: number;
  guarded: boolean;
  /** Guardian campaign cleared and still held — not lost ground. */
  conquered: boolean;
  /** Real conquest history: pressure returned after a prior clear. */
  pressureReturned: boolean;
};

/**
 * Centralized presentation thresholds. Comments document the game metaphor;
 * numbers are territory-relative ratios, not calendar timers.
 */
export const TERRITORY_VISUAL_THRESHOLDS = {
  /** Cooling signal begins when this share of customers is dimming. */
  atRiskDimmingShare: 0.2,
  /** Territory reads as cooling when dimming + quiet together cross this. */
  coolingDeclineShare: 0.35,
  /** Overgrown requires multiple customers AND majority decline — never one person. */
  overgrownMinCustomers: 3,
  overgrownDarkShare: 0.45,
  /** Infested is late-stage territory decline, not a single dormant account. */
  infestedMinCustomers: 4,
  infestedDarkShare: 0.6,
  /** Closed for construction: severe territory-level quiet with no active lights. */
  closedMinCustomers: 3,
  closedDarkShare: 0.75,
} as const;

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return part / total;
}

export function deriveTerritoryVisualState(
  mix: TerritoryCustomerMix
): TerritoryVisualState {
  const total = mix.active + mix.dimming + mix.dark;

  if (mix.guarded && total === 0) return "locked_opportunity";
  if (mix.pressureReturned && total === 0) return "lost_ground";
  // No located customers and never conquered: Goldline has not established
  // real business here yet. That is prospective "what could be" territory,
  // never "healthy" — an empty neighbourhood is not a thriving one.
  if (total === 0 && !mix.conquered) return "locked_opportunity";
  if (total === 0) return "healthy";

  // One dormant customer must not visually destroy a neighborhood.
  if (total === 1) {
    if (mix.dark === 1) return "at_risk";
    if (mix.dimming === 1) return "at_risk";
    return "healthy";
  }

  const dimmingShare = share(mix.dimming, total);
  const darkShare = share(mix.dark, total);
  const declineShare = share(mix.dimming + mix.dark, total);
  const { overgrownMinCustomers, overgrownDarkShare, infestedMinCustomers, infestedDarkShare, closedMinCustomers, closedDarkShare, atRiskDimmingShare, coolingDeclineShare } =
    TERRITORY_VISUAL_THRESHOLDS;

  if (
    total >= closedMinCustomers &&
    darkShare >= closedDarkShare &&
    mix.active === 0
  ) {
    return "closed_construction";
  }
  if (total >= infestedMinCustomers && darkShare >= infestedDarkShare) {
    return "infested";
  }
  if (total >= overgrownMinCustomers && darkShare >= overgrownDarkShare) {
    return "overgrown";
  }
  if (declineShare >= coolingDeclineShare) return "cooling";
  if (dimmingShare >= atRiskDimmingShare || darkShare > 0) return "at_risk";
  return "healthy";
}

export function territoryVisualStateLabel(state: TerritoryVisualState): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "at_risk":
      return "At Risk";
    case "cooling":
      return "Cooling";
    case "overgrown":
      return "Overgrown";
    case "infested":
      return "Infested";
    case "closed_construction":
      return "Closed for Construction";
    case "lost_ground":
      return "Lost Ground";
    case "locked_opportunity":
      return "Locked Opportunity";
  }
}

/** Stable hash for deterministic world composition — never use Math.random(). */
export function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Whether a territory earns a state gel at all. A conquered territory with no
 * located customers has no evidence to paint — it stays neutral rather than
 * pretending to be healthy or lost.
 */
export function territoryStateHasEvidence(mix: TerritoryCustomerMix): boolean {
  const total = mix.active + mix.dimming + mix.dark;
  if (total > 0) return true;
  if (mix.guarded || mix.pressureReturned) return true;
  return !mix.conquered;
}

/**
 * Painterly gel texture strength. These are strong enough to read from the
 * whole-city view; the tint below carries the colour, the texture carries the
 * "weather" at the territory edges.
 */
export function gelOpacityForState(state: TerritoryVisualState): number {
  switch (state) {
    case "healthy":
      return 0.55;
    case "at_risk":
      return 0.6;
    case "cooling":
      return 0.62;
    case "overgrown":
      return 0.66;
    case "infested":
      return 0.7;
    case "closed_construction":
      return 0.66;
    case "lost_ground":
      return 0.64;
    case "locked_opportunity":
      return 0.3;
  }
}

/**
 * Flat colour tint clipped inside the territory mask, blended (multiply) so
 * the architecture underneath stays legible while the neighbourhood clearly
 * reads green / amber / red / dusk from across the room.
 */
export function gelTintForState(state: TerritoryVisualState): {
  color: string;
  opacity: number;
} {
  switch (state) {
    case "healthy":
      return { color: "#3fd06a", opacity: 0.36 };
    case "at_risk":
      return { color: "#f7c62a", opacity: 0.42 };
    case "cooling":
      return { color: "#e0452a", opacity: 0.44 };
    case "overgrown":
      return { color: "#6a9a1c", opacity: 0.48 };
    case "infested":
      return { color: "#8f7d33", opacity: 0.48 };
    case "closed_construction":
      return { color: "#9a9aa2", opacity: 0.46 };
    case "lost_ground":
      return { color: "#5e5868", opacity: 0.5 };
    // Locked is the quiet background most of the city sits in: a cool dusk
    // that lets lit neighbourhoods pop, never a purple blanket.
    case "locked_opportunity":
      return { color: "#3b4276", opacity: 0.22 };
  }
}
