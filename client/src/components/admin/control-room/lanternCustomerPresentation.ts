import type { CustomerCadence } from "@shared/lanternCity";
import type { ProjectedPhysicalWorldState } from "@shared/goldlineWorld";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

export type CustomerLanternKind =
  | "active"
  | "cooling"
  | "quiet"
  | "hearth"
  | "opportunity";

/**
 * Verified standing / recurring service only.
 *
 * Weekly cadence inference is NOT recurring service. Wire this when the backend
 * exposes explicit persisted recurring/standing evidence on the customer record.
 */
export type VerifiedRecurringServiceEvidence = {
  verified: boolean;
  source: string | null;
};

export function hasVerifiedRecurringService(_input: {
  identityKey: string;
}): VerifiedRecurringServiceEvidence {
  return { verified: false, source: null };
}

export function lanternAssetForCadence(
  cadence: CustomerCadence,
  recurring: VerifiedRecurringServiceEvidence
): string {
  if (recurring.verified) {
    return LANTERN_CITY_V5_ASSETS.lanterns.hearth;
  }
  if (cadence.state === "dark") return LANTERN_CITY_V5_ASSETS.lanterns.quiet;
  if (cadence.state === "dimming") return LANTERN_CITY_V5_ASSETS.lanterns.cooling;
  return LANTERN_CITY_V5_ASSETS.lanterns.active;
}

export function lanternAssetForClusterState(state: "active" | "dimming" | "dark") {
  if (state === "dark") return LANTERN_CITY_V5_ASSETS.lanterns.quiet;
  if (state === "dimming") return LANTERN_CITY_V5_ASSETS.lanterns.cooling;
  return LANTERN_CITY_V5_ASSETS.lanterns.active;
}

export function clusterLanternState(cluster: {
  total: number;
  active: number;
  dimming: number;
  dark: number;
}): "active" | "dimming" | "dark" {
  if (cluster.dark === cluster.total) return "dark";
  if (cluster.dimming > 0 || cluster.dark > 0) return "dimming";
  return "active";
}

export type TransientLanternEvidence = {
  outreachSent: boolean;
  replyReceived: boolean;
  orderRestored: boolean;
};

/**
 * Transient lantern overlays follow world projection evidence only.
 * Clicks and tool selection must never manufacture these states.
 */
export function deriveTransientLanternEvidence(
  projection: ProjectedPhysicalWorldState | undefined | null
): TransientLanternEvidence {
  if (!projection) {
    return { outreachSent: false, replyReceived: false, orderRestored: false };
  }
  const orderRestored = projection.recoveryState === "recovered";
  const outreachSent =
    !orderRestored && projection.recoveryState === "attempted";
  // No canonical persisted customer-reply evidence exists in projection yet.
  const replyReceived = false;
  return { outreachSent, replyReceived, orderRestored };
}

export function transientLanternOverlay(
  evidence: TransientLanternEvidence
): string | null {
  if (evidence.orderRestored) {
    return LANTERN_CITY_V5_ASSETS.lanterns.restored;
  }
  if (evidence.replyReceived) {
    return LANTERN_CITY_V5_ASSETS.lanterns.ember;
  }
  if (evidence.outreachSent) {
    return LANTERN_CITY_V5_ASSETS.lanterns.spark;
  }
  return null;
}

export function lanternNeedsRekindling(state: "active" | "dimming" | "dark") {
  return state === "dimming" || state === "dark";
}
