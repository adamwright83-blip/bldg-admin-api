/**
 * StrategyEngine Path Choice Service (Slice 6)
 * Handles operator strategic choice from the fork.
 * Enforces:
 * - G1: Warmth only for kept word. Path choice emits ZERO warmth.
 * - G6: Choosing a play with spend does NOT bypass spend clearance or approval.
 * - Voice choices require verified read-back and confirmation.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { strategyPathChoices } from "../../drizzle/schema";
import { getStrategyPlayById } from "./playGenerator";

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

  const play = getStrategyPlayById(input.playId, input.tenantId);
  if (!play) {
    throw new Error("Strategy path choice requires an existing play belonging to the authorized tenant");
  }
  const previousPlayId = activePlayByTenant.get(input.tenantId) ?? null;

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
  const db = await getDb();
  const allowTestMemory = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  if (!db && !allowTestMemory) {
    throw new Error("Strategy path choice cannot commit without durable database availability");
  }
  if (db) {
    await db.insert(strategyPathChoices).values({
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
  }

  play.status = "active";
  activePlayByTenant.set(input.tenantId, input.playId);
  choiceStore.set(choiceId, result);

  return result;
}

export function getActiveStrategicPath(tenantId: string): string | null {
  return activePlayByTenant.get(tenantId) ?? null;
}

export function _clearChoiceStore(): void {
  choiceStore.clear();
  activePlayByTenant.clear();
}
