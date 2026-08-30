/**
 * THE CANONICAL BUILDING — one physical object, two different real games.
 *
 * Goldline currently holds four independent views of the same street address:
 *
 *   - `shared/buildings.ts`      — a building with residents and a real unit count
 *   - `shared/propertyTowers.ts` — a building as a Tower Wars combatant
 *   - `shared/commercialMission.ts` — a building as a thirteen-state sales siege
 *   - `shared/lanternCity.ts`    — a building's customers as points on real geography
 *
 * None of them knows the others exist, so 3545 Wilshire is four unrelated
 * records. This module is the seam: it resolves those views onto ONE canonical
 * identity and expresses the two genuinely different games that can run on it.
 *
 *   SIEGE       — getting in. A commercial mission's thirteen states.
 *   PENETRATION — how much of the inside is yours. A finite, countable
 *                 denominator of real rentable units.
 *
 * These must be connected without being collapsed. Winning a commercial account
 * does not mean you have the residents; it means the resident game becomes
 * legitimately playable. `account_won` is the hinge, not the finish.
 *
 * THREE RULES THIS FILE ENFORCES STRUCTURALLY, NOT BY CONVENTION
 *
 * 1. No fabricated geography. `latitude`/`longitude` are null unless a real
 *    geographic source supplied them. `worldAnchor` and `regionKey` are fiction
 *    anchors ("fortress_gate", "gold_side_entrance") and are deliberately not
 *    accepted anywhere in this module — there is no parameter to pass them to.
 *
 * 2. No denominator laundering. A penetration share always travels with the
 *    verification status of the denominator that produced it. A placeholder
 *    unit count can never be presented with the confidence of a verified one,
 *    because `PenetrationReading` has no shape that omits `denominatorVerified`.
 *
 * 3. No invented access. `penetrationAccess` records WHY the resident game is
 *    playable. A building whose residents predate any commercial mission
 *    reports `preexisting_residents` and never `commercial_win` — the seam
 *    describes the chain it can actually evidence, and says so when a link is
 *    missing.
 */
import type { CommercialMissionStatus } from "./commercialMission";
import type { WorldMissionState } from "./driverGameWorld";
import { matchBuilding, type BuildingConfig } from "./buildings";
import {
  normalizePropertyTower,
  type PropertyTowerMatch,
} from "./propertyTowers";
import type { TowerDamageState, TowerWarsBuildingId } from "./towerWars";

/* ── Identity ───────────────────────────────────────────────────────────── */

/** Which of the four existing views contributed to this identity. */
export const BUILDING_IDENTITY_SOURCES = [
  "building_config",
  "property_tower",
  "commercial_mission",
] as const;
export type BuildingIdentitySource =
  (typeof BUILDING_IDENTITY_SOURCES)[number];

/**
 * Where a coordinate came from. There is deliberately no "estimated" or
 * "inferred" member: a building either has a coordinate from a real geographic
 * source or it has none.
 */
export const COORDINATE_SOURCES = [
  "geocoded_address",
  "provider_sourced",
  "operator_confirmed",
] as const;
export type CoordinateSource = (typeof COORDINATE_SOURCES)[number];

export type BuildingCoordinate = {
  latitude: number;
  longitude: number;
  source: CoordinateSource;
};

export type CanonicalBuildingIdentity = {
  /** Stable id. Prefers the building config id, then the tower property group. */
  canonicalId: string;
  displayName: string;
  addressCanonical: string | null;
  identitySources: BuildingIdentitySource[];
  /** Null unless a real geographic source supplied it. Never estimated. */
  coordinate: BuildingCoordinate | null;
};

/* ── The siege half ─────────────────────────────────────────────────────── */

/**
 * How deep into a building you actually are.
 *
 * This exists because `visualStateForBusinessStatus` collapses five materially
 * different real statuses — game_active, phone_ready, preparing, en_route,
 * arrived — into a single "active". The pipeline knows the difference between
 * holding someone's phone number and standing in their lobby; the world does
 * not. The ordering below is load-bearing: it is a ladder, and `siegeDepthRank`
 * is what makes "the next sealed door" a computable thing rather than a
 * narrative flourish.
 */
export const SIEGE_DEPTHS = [
  /** Nothing has happened yet. */
  "unsighted",
  /** Chosen as a target. */
  "sighted",
  /** Prepared — briefing done, not yet contactable. */
  "briefed",
  /** A real human is reachable. */
  "reachable",
  /** Committed to going. */
  "committed",
  /** Physically travelling to it. */
  "inbound",
  /** Physically present outside. */
  "at_the_door",
  /** Have been inside and talked to someone. */
  "inside",
  /** Won. The siege is over and the other game begins. */
  "held",
  /** Lost. */
  "closed",
] as const;
export type SiegeDepth = (typeof SIEGE_DEPTHS)[number];

/**
 * Rank within the ladder. `closed` deliberately shares no ordering with the
 * others — it is an exit, not a depth — and returns -1 so callers cannot
 * accidentally treat a lost account as progress.
 */
export function siegeDepthRank(depth: SiegeDepth): number {
  if (depth === "closed") return -1;
  return SIEGE_DEPTHS.indexOf(depth);
}

/** The single mapping from real mission status to physical depth. */
export function siegeDepthForStatus(
  status: CommercialMissionStatus
): SiegeDepth {
  switch (status) {
    case "candidate":
      return "unsighted";
    case "selected":
      return "sighted";
    case "game_ready":
    case "game_active":
    case "game_completed":
      return "briefed";
    case "phone_ready":
      return "reachable";
    case "preparing":
      return "committed";
    case "en_route":
      return "inbound";
    case "arrived":
      return "at_the_door";
    case "visit_completed":
    case "follow_up":
      return "inside";
    case "won":
      return "held";
    case "lost":
      return "closed";
  }
}

export type BuildingSiegeState = {
  missionId: number;
  missionStatus: CommercialMissionStatus;
  /** Preserved so the existing world projection stays the authority it is. */
  worldState: WorldMissionState | null;
  depth: SiegeDepth;
  lossReason: string | null;
  verifiedAnnualValueCents: number | null;
  realizedRevenueCents: number;
};

/* ── The penetration half ───────────────────────────────────────────────── */

/**
 * Why the resident game is playable at all.
 *
 * `commercial_win` may only be claimed when a real won mission is present on
 * this same canonical object. A building that simply has residents — which is
 * true of both currently-configured buildings — reports
 * `preexisting_residents`, because claiming a win caused it would be inventing
 * a causal link the data does not support.
 */
export const PENETRATION_ACCESS = [
  "commercial_win",
  "preexisting_residents",
  "none",
] as const;
export type PenetrationAccess = (typeof PENETRATION_ACCESS)[number];

/**
 * A penetration share and the trustworthiness of the denominator behind it,
 * inseparably. There is no constructor here that yields a share without its
 * verification flag.
 */
export type PenetrationReading = {
  /** Real rentable units. The one honest denominator in the whole product. */
  totalUnits: number;
  /** False when `total_units` is a placeholder pending verification. */
  denominatorVerified: boolean;
  signups: number;
  paidResidents: number;
  /** 0..1. Always paired with `denominatorVerified` above. */
  signupShare: number;
  paidShare: number;
  access: PenetrationAccess;
};

export function readPenetration(input: {
  totalUnits: number;
  needsVerification?: boolean;
  signups: number;
  paidResidents: number;
  access: PenetrationAccess;
}): PenetrationReading | null {
  if (!Number.isFinite(input.totalUnits) || input.totalUnits <= 0) return null;
  const clampShare = (count: number) =>
    Math.max(0, Math.min(1, count / input.totalUnits));
  return {
    totalUnits: input.totalUnits,
    denominatorVerified: input.needsVerification !== true,
    signups: Math.max(0, input.signups),
    paidResidents: Math.max(0, input.paidResidents),
    signupShare: clampShare(Math.max(0, input.signups)),
    paidShare: clampShare(Math.max(0, input.paidResidents)),
    access: input.access,
  };
}

/* ── The war half ───────────────────────────────────────────────────────── */

/**
 * Tower Wars presence, split along the temporal contract Level 4 already uses:
 * a legible TODAY match that settles at close of day into permanent history.
 *
 * `todayDamage` is the live match. `settledScars` is the count of attacks that
 * have already been settled into the building's permanent record and can never
 * be undone — which is what stops `incomingAttackCount` being a one-way ratchet
 * to a permanently critical facade with no second act.
 */
export type BuildingWarState = {
  towerWarsBuildingId: TowerWarsBuildingId;
  revenueCents: number;
  orderCount: number;
  todayDamage: TowerDamageState;
  settledScars: number;
};

/* ── Phase ──────────────────────────────────────────────────────────────── */

/**
 * Which game this building is actually in right now. Note that `held` and the
 * penetration phases are distinct: winning the account does not mean you have
 * the residents.
 */
export const BUILDING_PHASES = [
  "unknown",
  "prospect",
  "under_siege",
  "held_unpenetrated",
  "held_penetrating",
  "closed",
] as const;
export type BuildingPhase = (typeof BUILDING_PHASES)[number];

/* ── The canonical object ───────────────────────────────────────────────── */

export type CanonicalBuilding = {
  identity: CanonicalBuildingIdentity;
  siege: BuildingSiegeState | null;
  penetration: PenetrationReading | null;
  war: BuildingWarState | null;
  phase: BuildingPhase;
  /** True once the resident game is legitimately playable. */
  penetrationUnlocked: boolean;
};

export type CanonicalBuildingInput = {
  config?: BuildingConfig | null;
  tower?: PropertyTowerMatch | null;
  siege?: Omit<BuildingSiegeState, "depth"> | null;
  residents?: { signups: number; paidResidents: number } | null;
  war?: BuildingWarState | null;
  coordinate?: BuildingCoordinate | null;
};

function resolveIdentity(
  input: CanonicalBuildingInput
): CanonicalBuildingIdentity | null {
  const sources: BuildingIdentitySource[] = [];
  if (input.config) sources.push("building_config");
  if (input.tower && input.tower.propertyGroup !== "unknown") {
    sources.push("property_tower");
  }
  if (input.siege) sources.push("commercial_mission");
  if (!sources.length) return null;

  const canonicalId =
    input.config?.id ??
    (input.tower && input.tower.propertyGroup !== "unknown"
      ? input.tower.propertyGroup
      : null) ??
    (input.siege ? `commercial_mission:${input.siege.missionId}` : null);
  if (!canonicalId) return null;

  const displayName =
    input.config?.name ??
    (input.tower && input.tower.propertyDisplayName !== "Unknown"
      ? input.tower.propertyDisplayName
      : null) ??
    canonicalId;

  return {
    canonicalId,
    displayName,
    addressCanonical:
      input.config?.defaultAddress ??
      input.tower?.buildingAddressCanonical ??
      null,
    identitySources: sources,
    coordinate: input.coordinate ?? null,
  };
}

/**
 * The hinge. The resident game is playable when either a real commercial win
 * exists on this object, or residents already exist independently of any
 * mission. Both are real; they are simply different chains, and the reading
 * records which one applies.
 */
export function derivePenetrationAccess(input: {
  siegeDepth: SiegeDepth | null;
  hasResidentData: boolean;
}): PenetrationAccess {
  if (input.siegeDepth === "held") return "commercial_win";
  if (input.hasResidentData) return "preexisting_residents";
  return "none";
}

export function deriveBuildingPhase(input: {
  siegeDepth: SiegeDepth | null;
  penetration: PenetrationReading | null;
}): BuildingPhase {
  const { siegeDepth, penetration } = input;
  if (siegeDepth === "closed") return "closed";
  if (siegeDepth === "held") {
    return penetration && penetration.paidResidents > 0
      ? "held_penetrating"
      : "held_unpenetrated";
  }
  if (siegeDepth && siegeDepth !== "unsighted") return "under_siege";
  if (penetration && penetration.paidResidents > 0) return "held_penetrating";
  if (siegeDepth === "unsighted") return "prospect";
  if (penetration) return "held_unpenetrated";
  return "unknown";
}

/**
 * Compose the four views into one object. Pure — it adds no source of truth and
 * queries nothing. Returns null when nothing identifies a building at all.
 */
export function composeCanonicalBuilding(
  input: CanonicalBuildingInput
): CanonicalBuilding | null {
  const identity = resolveIdentity(input);
  if (!identity) return null;

  const siege: BuildingSiegeState | null = input.siege
    ? { ...input.siege, depth: siegeDepthForStatus(input.siege.missionStatus) }
    : null;

  const hasResidentData = Boolean(
    input.config &&
      input.residents &&
      (input.residents.signups > 0 || input.residents.paidResidents > 0)
  );

  const access = derivePenetrationAccess({
    siegeDepth: siege?.depth ?? null,
    hasResidentData,
  });

  const penetration =
    input.config && input.residents
      ? readPenetration({
          totalUnits: input.config.total_units,
          needsVerification: input.config.needsVerification,
          signups: input.residents.signups,
          paidResidents: input.residents.paidResidents,
          access,
        })
      : null;

  return {
    identity,
    siege,
    penetration,
    war: input.war ?? null,
    phase: deriveBuildingPhase({ siegeDepth: siege?.depth ?? null, penetration }),
    penetrationUnlocked: access !== "none",
  };
}

/* ── Resolution from a real address ─────────────────────────────────────── */

/**
 * Resolve one real address onto the canonical views that recognise it.
 *
 * Both existing matchers are consulted and neither is preferred silently: they
 * key off different evidence (`addressKeywords` vs canonical street tokens) and
 * a disagreement is a real data problem worth surfacing rather than resolving
 * by precedence. `agreement` reports it.
 */
export type CanonicalBuildingResolution = {
  config: BuildingConfig | null;
  tower: PropertyTowerMatch | null;
  /**
   * "both" — both matchers agree on the same building.
   * "config_only" / "tower_only" — only one recognised the address.
   * "conflict" — both matched, and they disagree. Never silently reconciled.
   * "none" — no view recognises this address.
   */
  agreement: "both" | "config_only" | "tower_only" | "conflict" | "none";
};

export function resolveCanonicalBuilding(
  address: string | null | undefined
): CanonicalBuildingResolution {
  const config = matchBuilding(address) ?? null;
  const towerMatch = normalizePropertyTower(address ?? null);
  const tower = towerMatch.propertyGroup === "unknown" ? null : towerMatch;

  if (config && tower) {
    return {
      config,
      tower,
      agreement: config.id === tower.propertyGroup ? "both" : "conflict",
    };
  }
  if (config) return { config, tower: null, agreement: "config_only" };
  if (tower) return { config: null, tower, agreement: "tower_only" };
  return { config: null, tower: null, agreement: "none" };
}

/* ── The continuity trace ───────────────────────────────────────────────── */

/**
 * The chain that decides whether Goldline is one world or several systems:
 *
 *   prospect building → commercial mission → real account_won →
 *   same canonical building object → resident penetration →
 *   real customer orders → Tower Wars performance → permanent history
 *
 * This is the executable form of that test. Every link reports whether it is
 * actually evidenced on THIS object, so an unbroken chain is a fact you can
 * assert rather than a claim in a design document. A link that is absent says
 * so; nothing here infers a link from a neighbouring one.
 */
export const CONTINUITY_STAGES = [
  "prospect_building",
  "commercial_mission",
  "account_won",
  "canonical_object",
  "resident_penetration",
  "customer_orders",
  "tower_wars_performance",
  "permanent_history",
] as const;
export type ContinuityStage = (typeof CONTINUITY_STAGES)[number];

export type ContinuityLink = {
  stage: ContinuityStage;
  present: boolean;
  /** What evidences it, or why it is absent. Never invented. */
  evidence: string | null;
};

export function traceBuildingContinuity(
  building: CanonicalBuilding
): ContinuityLink[] {
  const { identity, siege, penetration, war } = building;

  const link = (
    stage: ContinuityStage,
    present: boolean,
    evidence: string | null
  ): ContinuityLink => ({ stage, present, evidence });

  return [
    link(
      "prospect_building",
      siege !== null,
      siege ? `commercial mission ${siege.missionId}` : "no mission targets this building"
    ),
    link(
      "commercial_mission",
      siege !== null && siege.depth !== "unsighted",
      siege && siege.depth !== "unsighted"
        ? `status ${siege.missionStatus} (depth ${siege.depth})`
        : "mission never advanced past candidate"
    ),
    link(
      "account_won",
      siege?.depth === "held",
      siege?.depth === "held"
        ? "mission status won"
        : siege?.depth === "closed"
          ? `lost: ${siege.lossReason ?? "no reason recorded"}`
          : "not won"
    ),
    link(
      "canonical_object",
      identity.identitySources.length > 1,
      identity.identitySources.length > 1
        ? `resolved across ${identity.identitySources.join(", ")}`
        : `only ${identity.identitySources[0]} identifies this building`
    ),
    link(
      "resident_penetration",
      penetration !== null,
      penetration
        ? `${penetration.paidResidents}/${penetration.totalUnits} paid units` +
            (penetration.denominatorVerified ? "" : " (denominator unverified)")
        : "no resident unit data"
    ),
    link(
      "customer_orders",
      (war?.orderCount ?? 0) > 0,
      war && war.orderCount > 0
        ? `${war.orderCount} real orders`
        : "no orders recorded against this building"
    ),
    link(
      "tower_wars_performance",
      war !== null,
      war
        ? `${war.revenueCents} cents, today ${war.todayDamage}`
        : "not a Tower Wars combatant"
    ),
    link(
      "permanent_history",
      (war?.settledScars ?? 0) > 0,
      war && war.settledScars > 0
        ? `${war.settledScars} settled scars`
        : "nothing settled into permanent history yet"
    ),
  ];
}

/** True only when every link in the chain is evidenced on one object. */
export function hasUnbrokenContinuity(building: CanonicalBuilding): boolean {
  return traceBuildingContinuity(building).every(link => link.present);
}

/** The first missing link — the honest answer to "what is this building waiting on". */
export function firstBrokenLink(
  building: CanonicalBuilding
): ContinuityLink | null {
  return traceBuildingContinuity(building).find(link => !link.present) ?? null;
}
