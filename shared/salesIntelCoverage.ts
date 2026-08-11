import type {
  ObjectionArchetype,
  SalesIntelChannel,
  SalesIntelFramework,
} from "./salesIntel";
import { OBJECTION_ARCHETYPES, SALES_INTEL_CHANNELS } from "./salesIntel";

/**
 * Factual corpus coverage summary (Slice 49) — counts and statuses only,
 * never an invented "X% sales coverage" score.
 */
export type SalesIntelCoverageReport = {
  totalAcceptedFrameworks: number;
  byArchetype: Array<{ archetype: ObjectionArchetype; count: number; armoryReady: boolean }>;
  byChannel: Array<{ channel: SalesIntelChannel; count: number }>;
  byCreator: Array<{ creator: string; count: number }>;
  /** Real disagreement, not an error: >=2 distinct creators teaching a different responseFamily for the same archetype+channel. */
  conflicts: Array<{
    archetype: ObjectionArchetype;
    channel: SalesIntelChannel;
    responseFamilies: Array<{ responseFamily: string; creators: string[] }>;
  }>;
  newestAcceptedAt: string | null;
  oldestAcceptedAt: string | null;
};

export function computeSalesIntelCoverage(
  frameworks: SalesIntelFramework[]
): SalesIntelCoverageReport {
  const byArchetype = OBJECTION_ARCHETYPES.map(archetype => ({
    archetype,
    count: frameworks.filter(f => f.archetype === archetype).length,
  })).map(entry => ({ ...entry, armoryReady: entry.count > 0 }));

  const byChannel = SALES_INTEL_CHANNELS.map(channel => ({
    channel,
    count: frameworks.filter(f => f.channel === channel).length,
  }));

  const creatorCounts = new Map<string, number>();
  for (const f of frameworks) {
    creatorCounts.set(f.creatorName, (creatorCounts.get(f.creatorName) ?? 0) + 1);
  }
  const byCreator = Array.from(creatorCounts.entries())
    .map(([creator, count]) => ({ creator, count }))
    .sort((a, b) => b.count - a.count);

  // Group by (archetype, channel), then by responseFamily within that
  // group. A group with >1 distinct responseFamily, each taught by a
  // different creator, is real, preserved disagreement — surfaced as
  // intelligence, never silently merged.
  const conflicts: SalesIntelCoverageReport["conflicts"] = [];
  for (const archetype of OBJECTION_ARCHETYPES) {
    for (const channel of SALES_INTEL_CHANNELS) {
      const group = frameworks.filter(f => f.archetype === archetype && f.channel === channel);
      const byFamily = new Map<string, Set<string>>();
      for (const f of group) {
        if (!byFamily.has(f.responseFamily)) byFamily.set(f.responseFamily, new Set());
        byFamily.get(f.responseFamily)!.add(f.creatorName);
      }
      if (byFamily.size > 1) {
        conflicts.push({
          archetype,
          channel,
          responseFamilies: Array.from(byFamily.entries()).map(([responseFamily, creators]) => ({
            responseFamily,
            creators: Array.from(creators),
          })),
        });
      }
    }
  }

  const dates = frameworks.map(f => f.createdAt).sort();

  return {
    totalAcceptedFrameworks: frameworks.length,
    byArchetype,
    byChannel,
    byCreator,
    conflicts,
    newestAcceptedAt: dates.at(-1) ?? null,
    oldestAcceptedAt: dates.at(0) ?? null,
  };
}
