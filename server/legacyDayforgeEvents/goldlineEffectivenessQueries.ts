/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq, gte, sql } from "drizzle-orm";
import { legacyLegacyDayforgeProductEvents } from "../../drizzle/schema";
import { getDb } from "../db";
export type GoldlineEffectivenessSummary = {
  windowDays: number;
  play: {
    sessionsStarted: number;
    missionsApproached: number;
    missionsEngaged: number;
    encountersResolved: number;
  };
  businessAction: {
    weaponsSelected: number;
    weaponsUsed: number;
    coldCallTargetsStarted: number;
    coldCallOutcomesSaved: number;
  };
  trustedBusinessOutcome: {
    visitsCompleted: number;
    followUpsCreated: number;
    accountsWon: number;
    accountsLost: number;
  };
  missionProgression: { mutationsCreated: number; verifiedCaptures: number };
  recovery: { mutationsFollowed: number };
  scoutExpansion: {
    runsStarted: number;
    discoveriesCreated: number;
    missionsCreated: number;
  };
};
async function countEvent(i: {
  tenantId: string;
  eventName: string;
  since: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(legacyLegacyDayforgeProductEvents)
    .where(
      and(
        eq(legacyLegacyDayforgeProductEvents.tenantId, i.tenantId),
        eq(legacyLegacyDayforgeProductEvents.eventName, i.eventName),
        gte(legacyLegacyDayforgeProductEvents.occurredAt, i.since)
      )
    );
  return Number(row?.count ?? 0);
}
export async function getGoldlineEffectivenessSummary(i: {
  tenantId: string;
  windowDays?: number;
}): Promise<GoldlineEffectivenessSummary> {
  const windowDays = i.windowDays ?? 30,
    since = new Date(Date.now() - windowDays * 86400000),
    c = (eventName: string) =>
      countEvent({ tenantId: i.tenantId, eventName, since });
  const [
    sessionsStarted,
    missionsApproached,
    missionsEngaged,
    encountersResolved,
    weaponsSelected,
    weaponsUsed,
    coldCallTargetsStarted,
    coldCallOutcomesSaved,
    visitsCompleted,
    followUpsCreated,
    accountsWon,
    accountsLost,
    mutationsCreated,
    verifiedCaptures,
    mutationsFollowed,
    runsStarted,
    discoveriesCreated,
    missionsCreated,
  ] = await Promise.all([
    c("goldline_session_started"),
    c("mission_approached"),
    c("mission_engaged"),
    c("encounter_resolved"),
    c("armory_weapon_selected"),
    c("armory_weapon_used"),
    c("cold_call_target_started"),
    c("cold_call_outcome_saved"),
    c("visit_completed"),
    c("follow_up_created"),
    c("account_won"),
    c("account_lost"),
    c("mutation_created"),
    c("verified_capture"),
    c("mutation_followed"),
    c("scout_run_started"),
    c("scout_discovery_created"),
    c("scout_mission_created"),
  ]);
  return {
    windowDays,
    play: {
      sessionsStarted,
      missionsApproached,
      missionsEngaged,
      encountersResolved,
    },
    businessAction: {
      weaponsSelected,
      weaponsUsed,
      coldCallTargetsStarted,
      coldCallOutcomesSaved,
    },
    trustedBusinessOutcome: {
      visitsCompleted,
      followUpsCreated,
      accountsWon,
      accountsLost,
    },
    missionProgression: { mutationsCreated, verifiedCaptures },
    recovery: { mutationsFollowed },
    scoutExpansion: { runsStarted, discoveriesCreated, missionsCreated },
  };
}
