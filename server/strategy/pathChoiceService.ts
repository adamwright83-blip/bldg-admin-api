/**
 * StrategyEngine Path Choice Service (Slice 6)
 * Handles operator strategic choice from the fork.
 * Enforces:
 * - G1: Warmth only for kept word. Path choice emits ZERO warmth.
 * - G6: Choosing a play with spend does NOT bypass spend clearance or approval.
 * - Voice choices require verified read-back and confirmation.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { strategyPathChoices, strategyPlays, strategyPathOffers } from "../../drizzle/schema";
import { readStrategyPlayById, readPathOfferById } from "./playGenerator";

export type PathChoiceInput = {
  tenantId: string;
  playId: string;
  surface: "map" | "voice" | "admin";
  offerId?: string;
  readbackConfirmed?: boolean;
};

export type PathChoiceResult = {
  choiceId: string;
  tenantId: string;
  playId: string;
  surface: "map" | "voice" | "admin";
  chosenAt: string;
  needsApprovalToRun: boolean;
  approvalRequestId?: string | null;
};

const choiceStore = new Map<string, PathChoiceResult>();
let activePlayByTenant = new Map<string, string>();

/**
 * Validates spoken choice transcript for explicit confirmation.
 */
export function validateVoicePathChoiceConfirmation(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return (
    /\b(?:yes|correct|take it|let's do it|confirmed|i choose|that's the one|agreed)\b/i.test(normalized) &&
    !/\b(?:no|wait|cancel|nevermind|wrong|not that)\b/i.test(normalized)
  );
}

/**
 * Chooses a strategic path from the offered fork.
 */
export async function chooseStrategicPath(input: PathChoiceInput): Promise<PathChoiceResult> {
  // Voice surface requires explicit read-back and confirmation
  if (input.surface === "voice" && !input.readbackConfirmed) {
    throw new Error("Voice path choice requires an explicit read-back and spoken confirmation before recording.");
  }

  const db = await getDb();
  const allowTestMemory = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  if (!db && !allowTestMemory) {
    throw new Error("Strategy path choice cannot commit without durable database availability");
  }
  const play = await readStrategyPlayById(input.playId, input.tenantId);
  if (!play) {
    throw new Error("Strategy path choice requires an existing play belonging to the authorized tenant");
  }
  if (play.provenance.geographyVersion !== "tenant-market-v1") throw new Error("Strategy play geographic provenance unverified");
  if (input.offerId) {
    const offer = await readPathOfferById(input.offerId, input.tenantId);
    if (!offer || offer.status !== "active" || Date.parse(offer.expiresAt) <= Date.now() || !offer.offeredPlayIds.includes(input.playId)) {
      throw new Error("Strategy choice requires an active tenant-owned offer containing that play");
    }
  }
  const previousPlayId = await readActiveStrategicPath(input.tenantId);

  // Approval is an explicit pending request, never spend clearance.
  const approvalRequestId = play.needsApprovalToRun
    ? `appr_req_${randomUUID().slice(0, 12)}`
    : null;
  const choiceId = `choice_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const chosenAt = new Date().toISOString();
  const result: PathChoiceResult = {
    choiceId,
    tenantId: input.tenantId,
    playId: input.playId,
    surface: input.surface,
    chosenAt,
    needsApprovalToRun: play.needsApprovalToRun,
    approvalRequestId,
  };

  // Persist BEFORE publishing a successful active choice in process memory.
  // A DB outage must not become a reported committed strategic decision.
  if (db) {
    await db.transaction(async tx => {
    await tx.insert(strategyPathChoices).values({
      id: choiceId,
      tenantId: input.tenantId,
      offerId: input.offerId ?? null,
      playId: input.playId,
      chosenOnSurface: input.surface,
      previousPlayId,
      readbackConfirmed: Boolean(input.readbackConfirmed),
      chosenAt: new Date(chosenAt),
      createdAt: new Date(chosenAt),
    });
    await tx.update(strategyPlays).set({ status: "active" }).where(and(
      eq(strategyPlays.id, input.playId), eq(strategyPlays.tenantId, input.tenantId),
    ));
    if (input.offerId) await tx.update(strategyPathOffers).set({ status: "accepted" }).where(and(
      eq(strategyPathOffers.id, input.offerId), eq(strategyPathOffers.tenantId, input.tenantId),
    ));
    const [saved] = await tx.select().from(strategyPathChoices).where(and(
      eq(strategyPathChoices.id, choiceId), eq(strategyPathChoices.tenantId, input.tenantId),
    )).limit(1);
    if (!saved || saved.playId !== input.playId) throw new Error("Strategy choice durable readback failed");
    });
  }

  play.status = "active";
  activePlayByTenant.set(input.tenantId, input.playId);
  choiceStore.set(choiceId, result);

  return result;
}

/** Reads the persisted choice after restarts and on every live consumer. */
export async function readActiveStrategicPath(tenantId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return getActiveStrategicPath(tenantId);
    throw new Error("Active strategy path requires durable database availability");
  }
  const [choice] = await db.select().from(strategyPathChoices).where(eq(strategyPathChoices.tenantId, tenantId))
    .orderBy(desc(strategyPathChoices.chosenAt), desc(strategyPathChoices.id)).limit(1);
  if (!choice) return null;
  const play = await readStrategyPlayById(choice.playId, tenantId);
  return play && play.status !== "retired" && play.status !== "paused" ? play.id : null;
}

export function getActiveStrategicPath(tenantId: string): string | null {
  return activePlayByTenant.get(tenantId) ?? null;
}

export function _clearChoiceStore(): void {
  choiceStore.clear();
  activePlayByTenant.clear();
}
