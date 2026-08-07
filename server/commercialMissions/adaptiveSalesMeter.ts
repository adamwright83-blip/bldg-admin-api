import { and, eq, gte } from "drizzle-orm";
import { commercialMissionEvents, driverSalesScoreEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export const ADAPTIVE_SALES_WINDOW_DAYS = 30;

export type SalesLevel = 1 | 2 | 3 | 4;

type WalkInMetadata = {
  conversationNotes?: unknown;
  visitResult?: unknown;
  nextAction?: unknown;
  collateralDelivered?: unknown;
  quoteRequested?: unknown;
  pilotRequested?: unknown;
};

const LEVELS: Record<SalesLevel, {
  label: string;
  maxPoints: number;
  basicActivityMultiplier: number;
  nextLevelHint: string;
}> = {
  1: {
    label: "LEVEL 1 · BUILD THE MUSCLE",
    maxPoints: 120,
    basicActivityMultiplier: 1,
    nextLevelHint: "At this level, getting out of the car and creating real sales conversations matters a lot.",
  },
  2: {
    label: "LEVEL 2 · CREATE PIPELINE",
    maxPoints: 150,
    basicActivityMultiplier: 0.75,
    nextLevelHint: "Basic visits still count, but decision-maker conversations and concrete commitments matter more.",
  },
  3: {
    label: "LEVEL 3 · CONVERT",
    maxPoints: 180,
    basicActivityMultiplier: 0.5,
    nextLevelHint: "Activity is expected now. Quotes, pilots, follow-through, and wins drive the meter.",
  },
  4: {
    label: "LEVEL 4 · PRODUCE REVENUE",
    maxPoints: 220,
    basicActivityMultiplier: 0.25,
    nextLevelHint: "Showing up is baseline. Closed business and repeatable revenue are what move you now.",
  },
};

export function salesLevelFromRecentWins(wins: number): SalesLevel {
  if (wins >= 6) return 4;
  if (wins >= 3) return 3;
  if (wins >= 1) return 2;
  return 1;
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function scoreWalkInForLevel(metadata: WalkInMetadata | null | undefined, level: SalesLevel) {
  const notes = text(metadata?.conversationNotes);
  const nextAction = text(metadata?.nextAction);
  const visitResult = text(metadata?.visitResult);
  const reachedDecisionMaker = /\b(general manager|property manager|community manager|building manager|manager|director|owner|decision[ -]?maker|gm)\b/i.test(notes);
  const concreteCommitment = /\b(agreed|approved|permission|allowed|will post|post(?:ed)? (?:the )?(?:flyer|collateral)|put (?:it|them) up|interested|send (?:me|us)|email (?:me|us)|yes\b)/i.test(notes);
  const hasFollowUp = visitResult === "follow_up" || Boolean(nextAction);
  const collateral = truthy(metadata?.collateralDelivered);
  const quote = truthy(metadata?.quoteRequested);
  const pilot = truthy(metadata?.pilotRequested);
  const won = visitResult === "won";

  if (level === 1) {
    // Level 1 is deliberately generous. The behavior being trained is doing real selling.
    return Math.min(48,
      20 +
      (hasFollowUp ? 5 : 0) +
      (reachedDecisionMaker ? 6 : 0) +
      (concreteCommitment ? 6 : 0) +
      (nextAction ? 3 : 0) +
      (collateral ? 3 : 0) +
      (quote ? 5 : 0) +
      (pilot ? 7 : 0) +
      (won ? 10 : 0)
    );
  }

  if (level === 2) {
    return Math.min(35,
      8 +
      (hasFollowUp ? 3 : 0) +
      (reachedDecisionMaker ? 6 : 0) +
      (concreteCommitment ? 6 : 0) +
      (nextAction ? 2 : 0) +
      (collateral ? 2 : 0) +
      (quote ? 6 : 0) +
      (pilot ? 9 : 0) +
      (won ? 14 : 0)
    );
  }

  if (level === 3) {
    return Math.min(34,
      3 +
      (hasFollowUp ? 1 : 0) +
      (reachedDecisionMaker ? 4 : 0) +
      (concreteCommitment ? 5 : 0) +
      (quote ? 7 : 0) +
      (pilot ? 10 : 0) +
      (won ? 18 : 0)
    );
  }

  return Math.min(35,
    1 +
    (reachedDecisionMaker ? 2 : 0) +
    (concreteCommitment ? 3 : 0) +
    (quote ? 5 : 0) +
    (pilot ? 8 : 0) +
    (won ? 25 : 0)
  );
}

export async function getAdaptiveDriverSalesMeter(input: { tenantId: string; driverId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const since = new Date(Date.now() - ADAPTIVE_SALES_WINDOW_DAYS * 86_400_000);

  const [missionEvents, scoreEvents] = await Promise.all([
    db.select({
      missionId: commercialMissionEvents.missionId,
      eventName: commercialMissionEvents.eventName,
      toStatus: commercialMissionEvents.toStatus,
      metadataJson: commercialMissionEvents.metadataJson,
      createdAt: commercialMissionEvents.createdAt,
    }).from(commercialMissionEvents).where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.actorId, input.driverId),
      gte(commercialMissionEvents.createdAt, since),
    )),
    db.select({
      points: driverSalesScoreEvents.points,
      eventType: driverSalesScoreEvents.eventType,
    }).from(driverSalesScoreEvents).where(and(
      eq(driverSalesScoreEvents.tenantId, input.tenantId),
      eq(driverSalesScoreEvents.driverId, input.driverId),
      gte(driverSalesScoreEvents.occurredAt, since),
    )),
  ]);

  const wonMissionIds = new Set(
    missionEvents
      .filter(event => event.toStatus === "won")
      .map(event => event.missionId)
  );
  const wins = wonMissionIds.size;
  const level = salesLevelFromRecentWins(wins);
  const config = LEVELS[level];

  const walkInPoints = missionEvents
    .filter(event => event.eventName === "unplanned_walk_in")
    .reduce((sum, event) => sum + scoreWalkInForLevel(event.metadataJson as WalkInMetadata | null, level), 0);

  // Journals/comebacks remain useful, but they become supporting behavior as ability rises.
  const supportingPointsRaw = scoreEvents.reduce((sum, event) => sum + Number(event.points || 0), 0);
  const supportingPoints = Math.round(supportingPointsRaw * config.basicActivityMultiplier);
  const winBonus = wins * ({ 1: 0, 2: 18, 3: 24, 4: 30 } as const)[level];
  const points = walkInPoints + supportingPoints + winBonus;
  const progress = Math.min(1, Math.max(0, points / config.maxPoints));

  return {
    points,
    maxPoints: config.maxPoints,
    progress,
    stage: Math.min(4, Math.floor(progress * 5)),
    windowDays: ADAPTIVE_SALES_WINDOW_DAYS,
    level,
    levelLabel: config.label,
    nextLevelHint: config.nextLevelHint,
    recentWins: wins,
    breakdown: {
      walkInPoints,
      supportingPoints,
      winBonus,
    },
  };
}
