import { claireOwnedDatabasePresent } from "../turn/conversationStateStore";
import {
  listInterventionCandidates,
  type IssueLabel,
} from "../../revenueIntervention";
import { loadWeeklyGrowthCandidates } from "../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates";
import { addDaysYmd } from "../../analytics/businessPeriods";

export type OpenCollectionItem = {
  id: string;
  title: string;
  issue: string;
  recordedCents: number | null;
};

export type GrowthMotionItem = {
  id: string;
  title: string;
  motion: string;
};

export type OpenCollectionRead =
  | { status: "available"; items: OpenCollectionItem[] }
  | { status: "unavailable"; reason: string };

export type GrowthMotionRead =
  | { status: "available"; items: GrowthMotionItem[] }
  | { status: "unavailable"; reason: string };

const ISSUE_SPEECH: Record<IssueLabel, string> = {
  processing_stale_48h: "processing and stale",
  ready_unpaid_24h: "ready and unpaid",
  delivered_unpaid_24h: "delivered and unpaid",
  new_stale_48h: "new and stale",
  collected_financially_open: "collected and financially open",
  collected_stale_48h: "collected and stale",
  manual_risk_override: "manual risk",
};

function datesInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < 14 && cursor <= end; i += 1) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates.length ? dates : [start];
}

/**
 * Read-only. Uses the existing revenue-intervention scorer.
 * Does not send reminders, charge cards, or write action logs.
 */
export async function readBusinessGoalOpenCollections(input: {
  tenantId: string;
  now: Date;
}): Promise<OpenCollectionRead> {
  try {
    if (!(await claireOwnedDatabasePresent())) {
      return { status: "unavailable", reason: "Database unavailable" };
    }
    const candidates = await listInterventionCandidates(input.tenantId, input.now);
    return {
      status: "available",
      items: candidates.slice(0, 8).map(candidate => {
        const name = `${candidate.order.firstName ?? ""} ${candidate.order.lastName ?? ""}`.trim();
        const issue = ISSUE_SPEECH[candidate.issueLabel] ?? candidate.issueLabel.replace(/_/g, " ");
        return {
          id: `order:${candidate.order.id}`,
          title: name ? `${name}, order ${candidate.order.id}` : `Order ${candidate.order.id}`,
          issue,
          recordedCents: candidate.dollarValueCents > 0 ? candidate.dollarValueCents : null,
        };
      }),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Open collections unavailable",
    };
  }
}

/**
 * Read-only menu from the existing weekly growth candidate feed.
 * Titles are copied from the feed. Dollar values are never invented here.
 */
export async function readBusinessGoalGrowthMotions(input: {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  now: Date;
  timeZone: string;
  horizonStart: string;
  horizonEnd: string;
}): Promise<GrowthMotionRead> {
  try {
    const feed = await loadWeeklyGrowthCandidates({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      dayDirectorActorId: input.dayDirectorActorId,
      remainingDates: datesInclusive(input.horizonStart, input.horizonEnd),
      businessDate: input.horizonStart,
      now: input.now,
      timeZone: input.timeZone,
    });
    return {
      status: "available",
      items: feed.candidates.slice(0, 8).map(candidate => ({
        id: candidate.id,
        title: candidate.title,
        motion: candidate.motion,
      })),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Growth motions unavailable",
    };
  }
}
