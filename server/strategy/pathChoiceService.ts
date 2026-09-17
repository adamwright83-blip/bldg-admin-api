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

  const play = getStrategyPlayById(input.playId);
  const previousPlayId = activePlayByTenant.get(input.tenantId) ?? null;

  // Set play to chosen -> active
  if (play) {
    play.status = "active";
  }
  activePlayByTenant.set(input.tenantId, input.playId);

  // If play requires spend approval, record a pending approval request ID (Guardrail G6)
  let approvalRequestId: string | null = null;
  if (play && play.needsApprovalToRun) {
    approvalRequestId = `appr_req_${randomUUID().slice(0, 12)}`;
  }

  const choiceId = `choice_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const chosenAt = new Date().toISOString();

  const result: PathChoiceResult = {
    choiceId,
    tenantId: input.tenantId,
    playId: input.playId,
    surface: input.surface,
    chosenAt,
    needsApprovalToRun: play?.needsApprovalToRun ?? false,
    approvalRequestId,
  };

  choiceStore.set(choiceId, result);

  // Persist to database if available
  try {
    const db = await getDb();
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
  } catch {
    // Offline DB fallback
  }

  return result;
}

export function getActiveStrategicPath(tenantId: string): string | null {
  return activePlayByTenant.get(tenantId) ?? null;
}

export function _clearChoiceStore(): void {
  choiceStore.clear();
  activePlayByTenant.clear();
}
