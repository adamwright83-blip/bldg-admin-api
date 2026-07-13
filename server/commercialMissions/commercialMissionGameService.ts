import { and, desc, eq } from "drizzle-orm";
import {
  commercialMissionGameAttempts,
  commercialMissionGameResults,
  commercialMissionGameRewards,
} from "../../drizzle/schema";
import {
  calculateCommercialMissionXp,
  consecutiveCompletionDays,
  assertQualifyingCommercialMissionGameTelemetry,
  type CommercialMissionGameTelemetry,
} from "@shared/commercialMissionGame";
import { getDb } from "../db";
import {
  getCommercialMission,
  readCommercialMissionWith,
  transitionCommercialMissionWith,
} from "./commercialMissionStore";

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; errno?: number };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

function attemptView(row: typeof commercialMissionGameAttempts.$inferSelect) {
  return {
    gameAttemptId: row.id,
    missionId: row.missionId,
    missionVersion: row.missionVersion,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
  };
}

async function readGameState(input: { tenantId: string; missionId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const mission = await getCommercialMission(input);
  if (!mission) return null;
  const [attempts, results, rewards] = await Promise.all([
    db.select().from(commercialMissionGameAttempts).where(and(
      eq(commercialMissionGameAttempts.tenantId, input.tenantId),
      eq(commercialMissionGameAttempts.missionId, input.missionId),
    )).orderBy(desc(commercialMissionGameAttempts.startedAt)),
    db.select().from(commercialMissionGameResults).where(and(
      eq(commercialMissionGameResults.tenantId, input.tenantId),
      eq(commercialMissionGameResults.missionId, input.missionId),
    )).limit(1),
    db.select().from(commercialMissionGameRewards).where(and(
      eq(commercialMissionGameRewards.tenantId, input.tenantId),
      eq(commercialMissionGameRewards.missionId, input.missionId),
    )).limit(1),
  ]);
  const result = results[0] ?? null;
  const reward = rewards[0] ?? null;
  const canStart = mission.status === "game_ready" || mission.status === "game_active";
  return {
    mission,
    objective: "Complete the BORESLAY match to unlock the field mission",
    gameEligibility: {
      canStart,
      reason: canStart
        ? null
        : mission.status === "phone_ready"
          ? "This mission already has a qualifying BORESLAY result"
          : `Mission status ${mission.status} is not eligible for BORESLAY`,
    },
    attempts: attempts.map(attemptView),
    qualifyingResult: result ? {
      gameResultId: result.id,
      gameAttemptId: result.gameAttemptId,
      sparkScore: result.sparkScore,
      clockheadScore: result.clockheadScore,
      durationMs: result.durationMs,
      qualifiedAt: result.qualifiedAt.toISOString(),
    } : null,
    reward: reward ? {
      xpAwarded: reward.xpAwarded,
      streakDays: reward.streakDays,
      phoneMissionReady: mission.status === "phone_ready",
    } : null,
    phoneMissionUnlocked: mission.status === "phone_ready",
    phoneRoute: mission.status === "phone_ready" ? `/driver/sales-mission/${mission.id}` : null,
  };
}

export const getCommercialMissionGameState = readGameState;

export async function startCommercialMissionGame(input: {
  tenantId: string;
  missionId: number;
  playerId: string;
  expectedVersion: number;
  gameAttemptId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const duplicate = await tx.select().from(commercialMissionGameAttempts).where(and(
        eq(commercialMissionGameAttempts.tenantId, input.tenantId),
        eq(commercialMissionGameAttempts.id, input.gameAttemptId),
      )).limit(1);
      if (duplicate[0]) {
        if (duplicate[0].missionId !== input.missionId || duplicate[0].playerId !== input.playerId) {
          throw new Error("Game attempt ID is already bound to another mission or player");
        }
        return;
      }

      let mission = await readCommercialMissionWith(tx, input);
      if (!mission) throw new Error("Commercial mission not found");
      if (mission.version !== input.expectedVersion) {
        throw new Error(`Commercial mission version conflict: expected ${input.expectedVersion}, found ${mission.version}`);
      }
      if (mission.status === "game_active") {
        const now = new Date();
        const activeAttempts = await tx.select().from(commercialMissionGameAttempts).where(and(
          eq(commercialMissionGameAttempts.tenantId, input.tenantId),
          eq(commercialMissionGameAttempts.missionId, input.missionId),
          eq(commercialMissionGameAttempts.status, "active"),
        ));
        for (const attempt of activeAttempts) {
          await tx.update(commercialMissionGameAttempts).set({
            status: "abandoned",
            endedAt: now,
            durationMs: Math.max(0, now.getTime() - attempt.startedAt.getTime()),
            telemetryJson: { reason: "recovered_by_new_attempt" },
          }).where(and(
            eq(commercialMissionGameAttempts.tenantId, input.tenantId),
            eq(commercialMissionGameAttempts.id, attempt.id),
            eq(commercialMissionGameAttempts.status, "active"),
          ));
        }
        mission = await transitionCommercialMissionWith(tx, {
          tenantId: input.tenantId,
          missionId: input.missionId,
          expectedVersion: mission.version,
          toStatus: "game_ready",
          actor: { type: "game", id: input.playerId },
          idempotencyKey: `game-recover:${input.gameAttemptId}`,
          metadata: { recoveredAttemptIds: activeAttempts.map(attempt => attempt.id) },
        });
      }
      if (mission.status !== "game_ready") throw new Error(`Commercial mission is not game-ready: ${mission.status}`);
      await tx.insert(commercialMissionGameAttempts).values({
        id: input.gameAttemptId,
        tenantId: input.tenantId,
        missionId: input.missionId,
        missionVersion: mission.version,
        playerId: input.playerId,
        status: "active",
      });
      await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: mission.version,
        toStatus: "game_active",
        actor: { type: "game", id: input.playerId },
        idempotencyKey: `game-start:${input.gameAttemptId}`,
        metadata: { gameAttemptId: input.gameAttemptId },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const state = await readGameState(input);
  if (!state) throw new Error("Commercial mission game state is missing after start");
  const attempt = state.attempts.find(candidate => candidate.gameAttemptId === input.gameAttemptId);
  if (!attempt) throw new Error("Idempotent game attempt result is missing");
  return { ...state, activeAttempt: attempt };
}

export async function abandonCommercialMissionGame(input: {
  tenantId: string;
  missionId: number;
  playerId: string;
  expectedVersion: number;
  gameAttemptId: string;
  reason: "defeat" | "quit" | "restart";
  durationMs: number;
  telemetry?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const attempts = await tx.select().from(commercialMissionGameAttempts).where(and(
      eq(commercialMissionGameAttempts.tenantId, input.tenantId),
      eq(commercialMissionGameAttempts.id, input.gameAttemptId),
      eq(commercialMissionGameAttempts.missionId, input.missionId),
    )).limit(1);
    const attempt = attempts[0];
    if (!attempt || attempt.playerId !== input.playerId) throw new Error("Game attempt not found");
    if (attempt.status !== "active") return;
    const mission = await readCommercialMissionWith(tx, input);
    if (!mission) throw new Error("Commercial mission not found");
    if (mission.status !== "game_active") throw new Error(`Commercial mission game cannot be abandoned from ${mission.status}`);
    await tx.update(commercialMissionGameAttempts).set({
      status: input.reason === "defeat" ? "failed" : "abandoned",
      endedAt: new Date(),
      durationMs: input.durationMs,
      telemetryJson: { ...input.telemetry, reason: input.reason },
    }).where(and(
      eq(commercialMissionGameAttempts.tenantId, input.tenantId),
      eq(commercialMissionGameAttempts.id, input.gameAttemptId),
      eq(commercialMissionGameAttempts.status, "active"),
    ));
    await transitionCommercialMissionWith(tx, {
      tenantId: input.tenantId,
      missionId: input.missionId,
      expectedVersion: input.expectedVersion,
      toStatus: "game_ready",
      actor: { type: "game", id: input.playerId },
      idempotencyKey: `game-abandon:${input.gameAttemptId}`,
      metadata: { gameAttemptId: input.gameAttemptId, reason: input.reason, durationMs: input.durationMs },
    });
  });
  const state = await readGameState(input);
  if (!state) throw new Error("Commercial mission game state is missing after abandonment");
  return state;
}

export async function completeCommercialMissionGame(input: {
  tenantId: string;
  missionId: number;
  playerId: string;
  expectedVersion: number;
  gameAttemptId: string;
  telemetry: CommercialMissionGameTelemetry;
}) {
  assertQualifyingCommercialMissionGameTelemetry(input.telemetry);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const existing = await tx.select().from(commercialMissionGameResults).where(and(
        eq(commercialMissionGameResults.tenantId, input.tenantId),
        eq(commercialMissionGameResults.missionId, input.missionId),
      )).limit(1);
      if (existing[0]) return;

      const attempts = await tx.select().from(commercialMissionGameAttempts).where(and(
        eq(commercialMissionGameAttempts.tenantId, input.tenantId),
        eq(commercialMissionGameAttempts.id, input.gameAttemptId),
        eq(commercialMissionGameAttempts.missionId, input.missionId),
      )).limit(1);
      const attempt = attempts[0];
      if (!attempt || attempt.playerId !== input.playerId) throw new Error("Game attempt not found");
      if (attempt.status !== "active") throw new Error(`Game attempt cannot qualify from ${attempt.status}`);
      let mission = await readCommercialMissionWith(tx, input);
      if (!mission) throw new Error("Commercial mission not found");
      if (mission.status !== "game_active") throw new Error(`Commercial mission game cannot be completed from ${mission.status}`);

      await tx.update(commercialMissionGameAttempts).set({
        status: "qualified",
        endedAt: new Date(),
        durationMs: input.telemetry.durationMs,
        telemetryJson: {
          sparkScore: input.telemetry.sparkScore,
          clockheadScore: input.telemetry.clockheadScore,
        },
      }).where(and(
        eq(commercialMissionGameAttempts.tenantId, input.tenantId),
        eq(commercialMissionGameAttempts.id, input.gameAttemptId),
        eq(commercialMissionGameAttempts.status, "active"),
      ));
      mission = await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: input.expectedVersion,
        toStatus: "game_completed",
        actor: { type: "game", id: input.playerId },
        idempotencyKey: `game-complete:${input.gameAttemptId}`,
        metadata: {
          gameAttemptId: input.gameAttemptId,
          sparkScore: input.telemetry.sparkScore,
          clockheadScore: input.telemetry.clockheadScore,
          durationMs: input.telemetry.durationMs,
        },
      });
      const resultInsert = await tx.insert(commercialMissionGameResults).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        missionVersion: attempt.missionVersion,
        gameAttemptId: input.gameAttemptId,
        playerId: input.playerId,
        sparkScore: input.telemetry.sparkScore,
        clockheadScore: input.telemetry.clockheadScore,
        durationMs: input.telemetry.durationMs,
        replayJson: input.telemetry.replay,
      });
      const gameResultId = Number(resultInsert[0].insertId);
      const previousRewards = await tx
        .select({ awardedAt: commercialMissionGameRewards.awardedAt })
        .from(commercialMissionGameRewards)
        .where(and(
          eq(commercialMissionGameRewards.tenantId, input.tenantId),
          eq(commercialMissionGameRewards.playerId, input.playerId),
        ))
        .orderBy(desc(commercialMissionGameRewards.awardedAt))
        .limit(60);
      const now = new Date();
      await tx.insert(commercialMissionGameRewards).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        gameResultId,
        playerId: input.playerId,
        xpAwarded: calculateCommercialMissionXp(input.telemetry),
        streakDays: consecutiveCompletionDays([now, ...previousRewards.map(row => row.awardedAt)], now),
        awardedAt: now,
      });
      await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: mission.version,
        toStatus: "phone_ready",
        actor: { type: "game", id: input.playerId },
        idempotencyKey: `phone-unlock:${input.missionId}`,
        metadata: { gameAttemptId: input.gameAttemptId, gameResultId },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const state = await readGameState(input);
  if (!state?.qualifyingResult || !state.reward || !state.phoneRoute) {
    throw new Error("Qualifying game result did not produce one reward and one phone unlock");
  }
  return state;
}
