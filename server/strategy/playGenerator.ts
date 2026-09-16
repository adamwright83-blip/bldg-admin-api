/**
 * StrategyEngine Play Generator (Slice 6)
 * Generates candidate growth plays from vertical templates and creates 2-3 route path offers.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { strategyPathOffers, strategyPlays } from "../../drizzle/schema";
import { laundryFluffFoldTemplate } from "./verticalTemplates/laundryFluffFold";
import { scoreStrategyPlay, type ScoreBreakdown } from "./decisionPolicy";
import { buildStrategySnapshot, getLatestStrategySnapshot } from "./snapshotBuilder";
import type { StrategySnapshot } from "./snapshotTypes";

export type StrategyPlay = {
  id: string;
  tenantId: string;
  businessName: string;
  worldName: string;
  hypothesis: string;
  primaryMetric: string;
  geography: string;
  stopsCount: number;
  isClustered: boolean;
  estimatedInitiationCost: number;
  estimatedSpendCents: number;
  spendCategory: string;
  confidence: "high" | "medium" | "low";
  scoreBreakdown: ScoreBreakdown;
  totalScore: number;
  status: "candidate" | "offered" | "chosen" | "active" | "paused" | "retired";
  needsApprovalToRun: boolean;
  minimumEvidenceThreshold: {
    minDays: number;
    minVolume: number;
    volumeUnit: string;
  };
  verticalKey: string;
  templateKey: string;
  provenance: {
    source: string;
    generatedAt: string;
  };
  createdAt: string;
};

export type PathOffer = {
  id: string;
  tenantId: string;
  plays: StrategyPlay[];
  recommendedPlayId: string;
  claireRationale: string;
  status: "active" | "accepted" | "expired" | "superseded";
  offeredAt: string;
  businessDate: string;
  expiresAt: string;
};

/** In-memory store for isolated testing & instant retrieval */
const playStore = new Map<string, StrategyPlay>();
const offerStore = new Map<string, PathOffer>();

/**
 * Generates and ranks candidate plays for a tenant based on the strategy snapshot.
 */
export async function generateCandidatePlays(
  tenantId: string,
  snapshot: StrategySnapshot
): Promise<StrategyPlay[]> {
  const template = laundryFluffFoldTemplate;
  const { payload } = snapshot;
  const nowIso = new Date().toISOString();

  const plays: StrategyPlay[] = [];

  for (const pt of template.playTemplates) {
    const playId = `play_${pt.templateKey}_${tenantId.slice(0, 8)}`;
    const spendCents = pt.defaultEstimatedSpendCents;
    const isApprovalCategory = payload.playgroundRules.approvalCategories.includes(pt.spendCategory);
    const exceedsBudget = spendCents > payload.playgroundRules.remainingBudgetCents;
    const needsApprovalToRun = spendCents > 0 && (isApprovalCategory || exceedsBudget);

    const score = scoreStrategyPlay(
      {
        templateKey: pt.templateKey,
        businessName: pt.businessName,
        worldName: pt.worldName,
        hypothesis: pt.hypothesis,
        primaryMetric: pt.primaryMetric,
        geography: pt.geography,
        stopsCount: pt.baseStops,
        isClustered: pt.isClustered,
        estimatedInitiationCost: pt.estimatedInitiationCost,
        estimatedSpendCents: spendCents,
        spendCategory: pt.spendCategory,
        confidence: pt.confidence,
      },
      snapshot
    );

    const play: StrategyPlay = {
      id: playId,
      tenantId,
      businessName: pt.businessName,
      worldName: pt.worldName,
      hypothesis: pt.hypothesis,
      primaryMetric: pt.primaryMetric,
      geography: pt.geography,
      stopsCount: pt.baseStops,
      isClustered: pt.isClustered,
      estimatedInitiationCost: pt.estimatedInitiationCost,
      estimatedSpendCents: spendCents,
      spendCategory: pt.spendCategory,
      confidence: pt.confidence,
      scoreBreakdown: score,
      totalScore: score.totalScore,
      status: "candidate",
      needsApprovalToRun,
      minimumEvidenceThreshold: pt.minimumEvidenceThreshold,
      verticalKey: template.verticalKey,
      templateKey: pt.templateKey,
      provenance: {
        source: `verticalTemplate:${template.verticalKey}`,
        generatedAt: nowIso,
      },
      createdAt: nowIso,
    };

    plays.push(play);
    playStore.set(play.id, play);
  }

  // Sort deterministically by totalScore descending
  plays.sort((a, b) => b.totalScore - a.totalScore);
  return plays;
}

/**
 * Creates or retrieves today's path offer (the 2-3 route fork).
 */
export async function getOrCreatePathOffer(
  tenantId: string,
  options: { now?: Date; forceNew?: boolean } = {}
): Promise<PathOffer> {
  const now = options.now ?? new Date();
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Check existing active offer for today
  if (!options.forceNew) {
    const existing = Array.from(offerStore.values()).find(
      o => o.tenantId === tenantId && o.businessDate === businessDate && o.status === "active"
    );
    if (existing) return existing;
  }

  let snapshot = await getLatestStrategySnapshot(tenantId);
  if (!snapshot) {
    snapshot = await buildStrategySnapshot(tenantId, { now });
  }

  const candidates = await generateCandidatePlays(tenantId, snapshot);
  // Pick top 2-3 distinct plays for the fork
  const offeredPlays = candidates.slice(0, 3);
  offeredPlays.forEach(p => (p.status = "offered"));

  const recommendedPlay = offeredPlays[0];
  const recommendedId = recommendedPlay ? recommendedPlay.id : "none";
  const claireRationale = recommendedPlay
    ? `${recommendedPlay.worldName} is the clearest path today. ${recommendedPlay.hypothesis}`
    : "Review the board and explore territory customer density.";

  const offerId = `offer_${businessDate.replace(/-/g, "")}_${tenantId}`;
  const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();

  const offer: PathOffer = {
    id: offerId,
    tenantId,
    plays: offeredPlays,
    recommendedPlayId: recommendedId,
    claireRationale,
    status: "active",
    offeredAt: now.toISOString(),
    businessDate,
    expiresAt,
  };

  offerStore.set(offer.id, offer);

  try {
    const db = await getDb();
    if (db) {
      await db.insert(strategyPathOffers).values({
        id: offer.id,
        tenantId: offer.tenantId,
        playIdsJson: offeredPlays.map(p => p.id),
        recommendedPlayId: offer.recommendedPlayId,
        claireRationale: offer.claireRationale,
        status: offer.status,
        offeredAt: now,
        businessDate: offer.businessDate,
        expiresAt: new Date(expiresAt),
        createdAt: now,
      });
    }
  } catch {
    // Offline DB fallback
  }

  return offer;
}

export function getStrategyPlayById(playId: string): StrategyPlay | null {
  return playStore.get(playId) ?? null;
}

export function _clearPlayAndOfferStore(): void {
  playStore.clear();
  offerStore.clear();
}
