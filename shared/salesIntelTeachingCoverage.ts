import type { SalesIntelTeaching, SalesIntelTeachingCategory } from "./salesIntelTeaching";
import { SALES_INTEL_TEACHING_CATEGORIES } from "./salesIntelTeaching";

/**
 * Factual general-teaching coverage — sibling to
 * shared/salesIntelCoverage.ts's objection-framework view, which is
 * preserved unchanged for gameplay/Armory mappings. This is the broader
 * corpus view: what the accepted teaching corpus covers by category,
 * creator, and source — counts only, never an invented completeness score.
 */
export type SalesIntelTeachingCoverageReport = {
  totalAcceptedTeachings: number;
  byCategory: Array<{ category: SalesIntelTeachingCategory; count: number }>;
  byCreator: Array<{ creator: string; count: number }>;
  bySource: Array<{ sourceArtifactId: string; count: number }>;
  newestAcceptedAt: string | null;
  oldestAcceptedAt: string | null;
};

export function computeSalesIntelTeachingCoverage(
  teachings: SalesIntelTeaching[]
): SalesIntelTeachingCoverageReport {
  const byCategory = SALES_INTEL_TEACHING_CATEGORIES.map(category => ({
    category,
    count: teachings.filter(t => t.category === category).length,
  }));

  const creatorCounts = new Map<string, number>();
  for (const t of teachings) {
    creatorCounts.set(t.creatorName, (creatorCounts.get(t.creatorName) ?? 0) + 1);
  }
  const byCreator = Array.from(creatorCounts.entries())
    .map(([creator, count]) => ({ creator, count }))
    .sort((a, b) => b.count - a.count);

  const sourceCounts = new Map<string, number>();
  for (const t of teachings) {
    sourceCounts.set(t.sourceArtifactId, (sourceCounts.get(t.sourceArtifactId) ?? 0) + 1);
  }
  const bySource = Array.from(sourceCounts.entries())
    .map(([sourceArtifactId, count]) => ({ sourceArtifactId, count }))
    .sort((a, b) => b.count - a.count);

  const dates = teachings.map(t => t.createdAt).sort();

  return {
    totalAcceptedTeachings: teachings.length,
    byCategory,
    byCreator,
    bySource,
    newestAcceptedAt: dates.at(-1) ?? null,
    oldestAcceptedAt: dates.at(0) ?? null,
  };
}
