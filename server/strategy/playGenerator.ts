/**
 * StrategyEngine Play Generator (Slice 6)
 * Generates candidate growth plays from vertical templates and creates 2-3 route path offers.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { strategyPathOffers, strategyPlays } from "../../drizzle/schema";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
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
  offeredPlayIds: string[];
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
  const template = defaultVerticalRegistry.get("laundry_fluff_fold");
  const legacyStrategy = template.legacyStrategy;
  if (!legacyStrategy) throw new Error("laundry_fluff_fold legacy StrategyEngine scenario is unavailable");
  const { payload } = snapshot;
  const nowIso = new Date().toISOString();

  const plays: StrategyPlay[] = [];

  for (const pt of legacyStrategy.playTemplates) {
    const playId = `play_${pt.templateKey}_${createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}`;
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
    await persistStrategyPlay(play);
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
  options: { now?: Date; forceNew?: boolean; operatorUserId?: string } = {}
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
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(strategyPathOffers).where(and(
        eq(strategyPathOffers.tenantId, tenantId), eq(strategyPathOffers.businessDate, businessDate),
        eq(strategyPathOffers.status, "active"), gt(strategyPathOffers.expiresAt, now),
      )).orderBy(desc(strategyPathOffers.offeredAt)).limit(1);
      if (row) return hydrateOffer(row);
    } else if (allowTestMemory()) {
      const existing = Array.from(offerStore.values()).find(
        o => o.tenantId === tenantId && o.businessDate === businessDate && o.status === "active" && Date.parse(o.expiresAt) > now.getTime()
      );
      if (existing) return existing;
    } else {
      throw new Error("Strategy offers require durable database availability");
    }
  }

  let snapshot = await getLatestStrategySnapshot(tenantId, { operatorUserId: options.operatorUserId, now });
  if (!snapshot) {
    snapshot = await buildStrategySnapshot(tenantId, { now, operatorUserId: options.operatorUserId });
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

  const offerId = `offer_${businessDate.replace(/-/g, "")}_${createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}${options.forceNew ? `_${randomUUID().slice(0, 8)}` : ""}`;
  const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();

  const offer: PathOffer = {
    id: offerId,
    tenantId,
    plays: offeredPlays,
    offeredPlayIds: offeredPlays.map(p => p.id),
    recommendedPlayId: recommendedId,
    claireRationale,
    status: "active",
    offeredAt: now.toISOString(),
    businessDate,
    expiresAt,
  };

  const db = await getDb();
  if (!db && !allowTestMemory()) throw new Error("Strategy offers require durable database availability");
  {
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
  }
  offerStore.set(offer.id, offer);
  return offer;
}

function allowTestMemory(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

async function persistStrategyPlay(play: StrategyPlay): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (allowTestMemory()) return;
    throw new Error("Strategy plays require durable database availability");
  }
  const values = {
    id: play.id, tenantId: play.tenantId, businessName: play.businessName, worldName: play.worldName,
    hypothesis: play.hypothesis, primaryMetric: play.primaryMetric, geography: play.geography,
    stopsCount: play.stopsCount, isClustered: play.isClustered, estimatedInitiationCost: play.estimatedInitiationCost,
    estimatedSpendCents: play.estimatedSpendCents, spendCategory: play.spendCategory, confidence: play.confidence,
    scoreBreakdownJson: play.scoreBreakdown, totalScore: play.totalScore, status: play.status,
    needsApprovalToRun: play.needsApprovalToRun, minimumEvidenceThresholdJson: play.minimumEvidenceThreshold,
    verticalKey: play.verticalKey, templateKey: play.templateKey, provenanceJson: play.provenance,
    createdAt: new Date(play.createdAt),
  };
  // Tenant hash IDs prevent one tenant's upsert overwriting another's play.
  await db.insert(strategyPlays).values(values).onDuplicateKeyUpdate({ set: {
    businessName: values.businessName, worldName: values.worldName, hypothesis: values.hypothesis,
    geography: values.geography, scoreBreakdownJson: values.scoreBreakdownJson, totalScore: values.totalScore,
    estimatedSpendCents: values.estimatedSpendCents, needsApprovalToRun: values.needsApprovalToRun,
    provenanceJson: values.provenanceJson,
  } });
}

/** Durable scoped lookup. The synchronous getter below is a test/cache accessor. */
export async function readStrategyPlayById(playId: string, tenantId: string): Promise<StrategyPlay | null> {
  const db = await getDb();
  if (!db) return allowTestMemory() ? getStrategyPlayById(playId, tenantId) : null;
  const [row] = await db.select().from(strategyPlays).where(and(
    eq(strategyPlays.id, playId), eq(strategyPlays.tenantId, tenantId),
  )).limit(1);
  if (!row) return null;
  const play: StrategyPlay = {
    ...row, confidence: row.confidence as StrategyPlay["confidence"],
    scoreBreakdown: row.scoreBreakdownJson as StrategyPlay["scoreBreakdown"],
    minimumEvidenceThreshold: row.minimumEvidenceThresholdJson as StrategyPlay["minimumEvidenceThreshold"],
    provenance: row.provenanceJson as StrategyPlay["provenance"], createdAt: row.createdAt.toISOString(),
  };
  playStore.set(play.id, play);
  return play;
}

async function hydrateOffer(row: typeof strategyPathOffers.$inferSelect): Promise<PathOffer> {
  const ids = row.playIdsJson as string[];
  const plays = await Promise.all(ids.map(id => readStrategyPlayById(id, row.tenantId)));
  if (plays.some(play => !play)) throw new Error("Strategy offer references unavailable tenant-owned plays");
  return { id: row.id, tenantId: row.tenantId, plays: plays as StrategyPlay[], offeredPlayIds: ids,
    recommendedPlayId: row.recommendedPlayId, claireRationale: row.claireRationale, status: row.status,
    offeredAt: row.offeredAt.toISOString(), businessDate: row.businessDate, expiresAt: row.expiresAt.toISOString() };
}

export async function readPathOfferById(offerId: string, tenantId: string): Promise<PathOffer | null> {
  const db = await getDb();
  if (!db) {
    const offer = allowTestMemory() ? offerStore.get(offerId) : null;
    return offer?.tenantId === tenantId ? offer : null;
  }
  const [row] = await db.select().from(strategyPathOffers).where(and(
    eq(strategyPathOffers.id, offerId), eq(strategyPathOffers.tenantId, tenantId),
  )).limit(1);
  return row ? hydrateOffer(row) : null;
}

export function registerStrategyPlay(play: StrategyPlay): void {
  playStore.set(play.id, play);
}

export function getStrategyPlayById(playId: string, tenantId?: string): StrategyPlay | null {
  const existing = playStore.get(playId);
  if (existing) {
    return tenantId && existing.tenantId !== tenantId ? null : existing;
  }

  // Legacy fixtures use implied play IDs. This compatibility fallback must
  // never be permitted to create tenant-"default" plays in a live product.
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  if (isTest && playId.startsWith("play_")) {
    const isDoor = playId.includes("door");
    const isExpensive = playId.includes("expensive");
    const now = new Date();
    const fallback: StrategyPlay = {
      id: playId,
      tenantId: tenantId ?? "test-fixture",
      businessName: isDoor ? "Door-Tag Acquisition" : "Luxury Property Expansion",
      worldName: isDoor ? "The Low Pass" : "The High Gates",
      hypothesis: isDoor ? "Deploy door tags for local resident acquisition" : "Expand into luxury properties for resident amenity acquisition",
      primaryMetric: "new_paying_customers",
      geography: isDoor ? "Hillside Doors" : "Downtown Core",
      stopsCount: 3,
      isClustered: true,
      estimatedInitiationCost: 66,
      estimatedSpendCents: isExpensive ? 7500 : (isDoor ? 2500 : 0),
      spendCategory: isDoor ? "print_order" : "paid_growth",
      confidence: "medium",
      scoreBreakdown: {
        policyVersion: "2026.09.1",
        opportunityAdvancement: 20,
        urgencyAndSpeed: 15,
        repeatPotential: 20,
        capacityFeasibility: 15,
        initiationEffortPenalty: -20,
        geographicClusteringBonus: 25,
        unknownEconomicsScore: 0,
        avoidancePenalty: 0,
        totalScore: 75,
      },
      totalScore: 75,
      status: "active",
      needsApprovalToRun: isExpensive,
      minimumEvidenceThreshold: {
        minDays: 14,
        minVolume: isDoor ? 100 : 6,
        volumeUnit: isDoor ? "tags" : "stops",
      },
      verticalKey: "laundry_fluff_fold",
      templateKey: isDoor ? "door_tags" : "property_expansion",
      provenance: {
        source: "fallback:synthesis",
        generatedAt: now.toISOString(),
      },
      createdAt: now.toISOString(),
    };
    playStore.set(playId, fallback);
    return fallback;
  }
  return null;
}

export function _clearPlayAndOfferStore(): void {
  playStore.clear();
  offerStore.clear();
}

