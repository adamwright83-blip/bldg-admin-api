/**
 * Goldline effectiveness — the compact admin view answering one question:
 * does playing Goldline correlate with more real business-growth behavior?
 *
 * Reuses `dayforge_product_events` directly rather than building a second
 * analytics store. All counts are within-tenant, coarse, and phrased as
 * observation ("during sessions") — never as a causal or percentage claim.
 * There is no experimental control group here, so nothing stronger than
 * "observed" or "associated" language is used anywhere this feeds the UI.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { dayforgeProductEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export type GoldlineEffectivenessSummary = {
  windowDays: number;
  play: {
    sessionsStarted: number;
    missionsEngaged: number;
    encountersResolved: number;
  };
  businessAction: {
    weaponsSelected: number;
    coldCallOutcomesSaved: number;
    followUpsCreated: number;
  };
  missionProgression: {
    mutationsCreated: number;
    verifiedCaptures: number;
  };
  recovery: {
    mutationsFollowed: number;
  };
  scoutExpansion: {
    runsStarted: number;
    discoveriesCreated: number;
    missionsCreated: number;
  };
};

async function countEvent(input: {
  tenantId: string;
  eventName: string;
  since: Date;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(dayforgeProductEvents)
    .where(
      and(
        eq(dayforgeProductEvents.tenantId, input.tenantId),
        eq(dayforgeProductEvents.eventName, input.eventName),
        gte(dayforgeProductEvents.occurredAt, input.since)
      )
    );
  return Number(row?.count ?? 0);
}

export async function getGoldlineEffectivenessSummary(input: {
  tenantId: string;
  windowDays?: number;
}): Promise<GoldlineEffectivenessSummary> {
  const windowDays = input.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const count = (eventName: string) =>
    countEvent({ tenantId: input.tenantId, eventName, since });

  const [
    sessionsStarted,
    missionsEngaged,
    encountersResolved,
    weaponsSelected,
    coldCallOutcomesSaved,
    followUpsCreated,
    mutationsCreated,
    verifiedCaptures,
    mutationsFollowed,
    runsStarted,
    discoveriesCreated,
    missionsCreated,
  ] = await Promise.all([
    count("goldline_session_started"),
    count("mission_engaged"),
    count("encounter_resolved"),
    count("armory_weapon_selected"),
    count("cold_call_outcome_saved"),
    count("follow_up_created"),
    count("mutation_created"),
    count("verified_capture"),
    count("mutation_followed"),
    count("scout_run_started"),
    count("scout_discovery_created"),
    count("scout_mission_created"),
  ]);

  return {
    windowDays,
    play: { sessionsStarted, missionsEngaged, encountersResolved },
    businessAction: { weaponsSelected, coldCallOutcomesSaved, followUpsCreated },
    missionProgression: { mutationsCreated, verifiedCaptures },
    recovery: { mutationsFollowed },
    scoutExpansion: { runsStarted, discoveriesCreated, missionsCreated },
  };
}
