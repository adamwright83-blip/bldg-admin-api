/**
 * Map FieldToday-shaped items onto GoldlineObjective without copying records.
 * Campaign composition references IDs only.
 */

import type { GoldlineObjective } from "./goldlineAdventure";

export type CampaignFieldTodaySource = {
  id: string;
  kind: string;
  status: string;
  urgency?: string;
  scheduledAt: string | null;
  subtitle?: string;
  title?: string;
  physicalEntityId?: string | null;
  destination?: { latitude: number | null; longitude: number | null } | null;
  source: { sourceReference: string };
};

function kindFor(kind: string): GoldlineObjective["kind"] {
  if (kind === "pickup") return "pickup";
  if (kind === "delivery") return "delivery";
  if (kind === "customer_recovery") return "recovery";
  if (kind === "follow_up" || kind === "commercial_call" || kind === "field_commitment") {
    return "follow_up";
  }
  if (kind === "contextual_move" || kind === "reported_opportunity") return "field_capture";
  return "commercial_visit";
}

function authorityFor(item: CampaignFieldTodaySource): GoldlineObjective["authority"] {
  if (item.kind === "pickup" || item.kind === "delivery" || item.kind === "field_commitment") {
    return "fixed_commitment";
  }
  if (
    item.kind === "follow_up" ||
    item.kind === "customer_recovery" ||
    item.kind === "commercial_visit" ||
    item.kind === "mission_dispatch"
  ) {
    return "persisted_task";
  }
  return "derived_recommendation";
}

function statusFor(item: CampaignFieldTodaySource): GoldlineObjective["status"] {
  if (
    item.status === "completed" ||
    item.status === "recovered" ||
    item.status === "published" ||
    item.status === "delivered" ||
    item.status === "collected"
  ) {
    return "completed";
  }
  if (item.urgency === "blocked" || item.kind === "payment_blocker") return "blocked";
  return "ready";
}

const ELIGIBLE_KINDS = new Set([
  "pickup",
  "delivery",
  "follow_up",
  "commercial_visit",
  "commercial_call",
  "mission_dispatch",
  "customer_recovery",
  "field_commitment",
  "reported_opportunity",
  "contextual_move",
]);

/**
 * Reality-first: only kinds that already exist on FieldToday become objectives.
 * Nothing is invented to fill a dramatic gap.
 */
export function goldlineObjectivesFromFieldToday(
  timeline: readonly CampaignFieldTodaySource[]
): GoldlineObjective[] {
  return timeline
    .filter(item => ELIGIBLE_KINDS.has(item.kind))
    .map(item => ({
      id: item.id,
      physicalEntityId: item.physicalEntityId ?? null,
      kind: kindFor(item.kind),
      authority: authorityFor(item),
      status: statusFor(item),
      latitude: item.destination?.latitude ?? null,
      longitude: item.destination?.longitude ?? null,
      windowStart: item.scheduledAt,
      windowEnd: null,
      priority: item.kind === "pickup" || item.kind === "delivery" ? 10 : 6,
      explanation: item.subtitle || item.title || item.source.sourceReference,
      sourceEvidenceReference: item.source.sourceReference,
    }));
}
