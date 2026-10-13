import { and, eq } from "drizzle-orm";
import { strategyMissionPlan } from "../../drizzle/schema";
import { getDb } from "../db";
import { type PreparedSalesPrep } from "./missionSalesPrep";
import type { StrategySnapshot } from "./snapshotTypes";

export interface SequencerConfig {
  maxGrowthOutingsPerDay: number; // default: 1
  maxStopsPerOuting: number;      // default: 6
  maxSupportAllowancePerDay: number; // default: 2
}

export const DEFAULT_SEQUENCER_CONFIG: SequencerConfig = {
  maxGrowthOutingsPerDay: 1,
  maxStopsPerOuting: 6,
  maxSupportAllowancePerDay: 2,
};

export interface SequencedMission {
  id: string;
  tenantId: string;
  playId: string;
  businessDate: string;
  missionType: "growth" | "support";
  status: "planned" | "wait_approval" | "active" | "completed" | "cancelled";
  title: string;
  geographyCluster: string | null;
  stopCount: number;
  spendReservationId: string | null;
  spendCategory: string | null;
  spendCents: number;
  preparedSalesPrep: PreparedSalesPrep;
  dedupeKey: string;
  dayDirectorCommitmentId: string | null;
}

// In-memory store for test/offline environments
const memoryMissions = new Map<string, SequencedMission>();

function memoryKey(tenantId: string, dedupeKey: string): string {
  return `${tenantId}:${dedupeKey}`;
}

export interface SequenceMissionsInput {
  tenantId: string;
  actorId: string;
  businessDate: string;
  snapshot: StrategySnapshot;
  config?: Partial<SequencerConfig>;
  forceReplan?: boolean;
}

export interface SequenceMissionsResult {
  growthMissions: SequencedMission[];
  supportMissions: SequencedMission[];
  totalStops: number;
  unresolvedIssues: string[];
  gapsDetected: string[];
  receipt: {
    businessDate: string;
    queuedGrowthCount: number;
    queuedSupportCount: number;
    verifiedInStorage: boolean;
  };
}

/**
 * Sequencer: lays out daily missions strictly under the active play,
 * plus a small support allowance for urgent customer service and ready-to-order customers.
 */
export async function sequenceDailyMissions(
  input: SequenceMissionsInput
): Promise<SequenceMissionsResult> {
  // Choosing a strategic direction is not approval of its individual work.
  // Historical rows remain readable below. All new execution goes through
  // strategicApproval -> Day Director after exact-revision operator acceptance.
  return {
    growthMissions: [], supportMissions: [], totalStops: 0,
    unresolvedIssues: ["Exact proposal-item approval is required. Review Claire's prepared recommendation before committing work."],
    gapsDetected: (input.snapshot.payload?.detectedGaps ?? []).map(gap => gap.description),
    receipt: { businessDate: input.businessDate, queuedGrowthCount: 0, queuedSupportCount: 0, verifiedInStorage: false },
  };
}

/**
 * Retrieve sequenced missions for a given tenant and date.
 */
export async function getSequencedMissionsForDate(
  tenantId: string,
  businessDate: string
): Promise<SequencedMission[]> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db
        .select()
        .from(strategyMissionPlan)
        .where(
          and(
            eq(strategyMissionPlan.tenantId, tenantId),
            eq(strategyMissionPlan.businessDate, businessDate)
          )
        );
      if (rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          tenantId: r.tenantId,
          playId: r.playId,
          dayDirectorCommitmentId: r.dayDirectorCommitmentId,
          commercialMissionId: r.commercialMissionId,
          businessDate: r.businessDate,
          missionType: r.missionType as "growth" | "support",
          status: r.status as SequencedMission["status"],
          title: r.title,
          geographyCluster: r.geographyCluster,
          stopCount: r.stopCount,
          spendReservationId: r.spendReservationId,
          spendCategory: r.spendCategory,
          spendCents: r.spendCents,
          preparedSalesPrep: r.preparedSalesPrepJson as PreparedSalesPrep,
          dedupeKey: r.dedupeKey,
        }));
      }
    } catch {
      // Fallback
    }
  }

  const results: SequencedMission[] = [];
  for (const m of memoryMissions.values()) {
    if (m.tenantId === tenantId && m.businessDate === businessDate) {
      results.push(m);
    }
  }
  return results;
}

export function _clearMemoryMissions(): void {
  memoryMissions.clear();
}

