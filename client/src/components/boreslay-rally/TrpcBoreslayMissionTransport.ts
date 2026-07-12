import type { CommercialMission } from "@shared/commercialMission";
import type {
  BoreslayMissionCompletionInput,
  BoreslayMissionCompletionResult,
  BoreslayMissionStartResult,
  BoreslayMissionTransport,
} from "./ProductionBoreslayMissionAdapter";

export type CommercialMissionApiRecord = {
  taskId: number;
  mission: CommercialMission;
};

export type CommercialMissionApi = {
  get(input: { taskId: number }): Promise<CommercialMissionApiRecord | null>;
  transition(input: {
    taskId: number;
    toStatus: CommercialMission["status"];
    actorType: "system" | "operator" | "driver" | "game";
    metadata?: Record<string, unknown>;
  }): Promise<CommercialMissionApiRecord>;
};

export type CommercialMissionGameTelemetry = {
  score: number;
  bossDamage: number;
  durationMs: number;
  replayJson?: unknown;
};

function requireRecord(
  value: CommercialMissionApiRecord | null,
  taskId: number
): CommercialMissionApiRecord {
  if (!value) {
    throw new Error(`Commercial mission task ${taskId} was not found`);
  }
  return value;
}

export function createTrpcBoreslayMissionTransport(input: {
  api: CommercialMissionApi;
  xpForCompletion?: (telemetry: CommercialMissionGameTelemetry) => number;
  currentStreakDays?: () => number;
}): BoreslayMissionTransport {
  const xpForCompletion =
    input.xpForCompletion ??
    (telemetry => Math.max(100, Math.min(1000, Math.round(telemetry.score / 10))));
  const currentStreakDays = input.currentStreakDays ?? (() => 0);

  return {
    async loadMission(taskId) {
      return requireRecord(await input.api.get({ taskId }), taskId).mission;
    },

    async startMission({ missionId: taskId, idempotencyKey }) {
      const record = await input.api.transition({
        taskId,
        toStatus: "game_active",
        actorType: "game",
        metadata: { idempotencyKey },
      });
      const result: BoreslayMissionStartResult = {
        mission: record.mission,
        startedAt: new Date().toISOString(),
        idempotencyKey,
      };
      return result;
    },

    async completeMission(
      completion: BoreslayMissionCompletionInput
    ): Promise<BoreslayMissionCompletionResult> {
      const record = await input.api.transition({
        taskId: completion.missionId,
        toStatus: "game_completed",
        actorType: "game",
        metadata: {
          idempotencyKey: completion.idempotencyKey,
          score: completion.score,
          bossDamage: completion.bossDamage,
          durationMs: completion.durationMs,
          replayJson: completion.replayJson,
        },
      });

      return {
        mission: record.mission,
        completedAt: new Date().toISOString(),
        xpAwarded: xpForCompletion(completion),
        streakDays: currentStreakDays(),
        phoneMissionReady: record.mission.status === "phone_ready",
      };
    },

    async unlockPhoneMission({ missionId: taskId, idempotencyKey }) {
      const record = await input.api.transition({
        taskId,
        toStatus: "phone_ready",
        actorType: "system",
        metadata: { idempotencyKey },
      });
      return record.mission;
    },

    async recordAbandonment({ missionId: taskId, elapsedMs, idempotencyKey }) {
      await input.api.transition({
        taskId,
        toStatus: "game_ready",
        actorType: "game",
        metadata: { idempotencyKey, elapsedMs, abandoned: true },
      });
    },
  };
}
