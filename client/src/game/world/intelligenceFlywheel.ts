/**
 * Personal Intelligence Flywheel (Slice 100) — connects existing Sales
 * Intelligence / Armory to personal real use inside the world, without
 * creating a second teaching-truth store.
 *
 * `toStrongholdIntel` is a thin adapter from the deliberately allowlisted
 * driver-safe server contract into the shape Stronghold's intel panel wants.
 * It performs no acceptance, filtering, or authorization — those gates have
 * already happened server-side before this data reaches the client.
 *
 * The flywheel loop itself (accepted teaching -> relevant move -> real
 * action -> authoritative outcome -> personal evidence -> improved future
 * guidance) is the existing Armory ranking pipeline
 * (`shared/goldlineProgression.ts`'s `GoldlineTechniqueProjection`,
 * `playerEvidenceRefs`) — untouched here. This module only makes accepted
 * teaching visible where the player is standing (Stronghold, mission
 * briefing) instead of only in the admin review screen.
 */
import type { DriverSafeSalesIntel } from "../../../../shared/driverSafeSalesIntel";
import type { StrongholdIntelSummary } from "./strongholdProjection";

export function toStrongholdIntel(
  report: DriverSafeSalesIntel
): StrongholdIntelSummary {
  return {
    acceptedTeachingCount: report.acceptedTeachingCount,
    byCategory: report.byCategory.map(entry => ({
      category: entry.category,
      count: entry.count,
    })),
  };
}

/**
 * A single briefing-relevant note, surfaced next to a mission — a dossier
 * entry, never a generic "CRM tip" popup. Sourced only from real accepted
 * teaching category counts; carries no fabricated confidence or ranking.
 */
export function briefingIntelNote(
  intel: StrongholdIntelSummary | null,
  category: string
): string | null {
  if (!intel) return null;
  const match = intel.byCategory.find(entry => entry.category === category);
  if (!match || match.count === 0) return null;
  return `${match.count} accepted teaching${match.count === 1 ? "" : "s"} on ${category.replace(/_/g, " ")}`;
}
