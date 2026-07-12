import { describe, expect, it, vi } from "vitest";
import { DEMO_MISSION } from "@shared/commercialMission";
import { createTrpcBoreslayMissionTransport } from "./TrpcBoreslayMissionTransport";

describe("createTrpcBoreslayMissionTransport", () => {
  it("maps game start, completion, and phone unlock onto one persisted task", async () => {
    const transitions: string[] = [];
    let mission = { ...DEMO_MISSION, status: "game_ready" as const };
    const api = {
      get: vi.fn(async () => ({ taskId: 42, mission })),
      transition: vi.fn(async (input: {
        taskId: number;
        toStatus: typeof mission.status | "game_active" | "game_completed" | "phone_ready";
      }) => {
        transitions.push(input.toStatus);
        mission = { ...mission, status: input.toStatus } as typeof mission;
        return { taskId: input.taskId, mission };
      }),
    };
    const transport = createTrpcBoreslayMissionTransport({
      api,
      xpForCompletion: () => 500,
      currentStreakDays: () => 4,
    });

    const started = await transport.startMission({
      missionId: 42,
      idempotencyKey: "start-42",
    });
    expect(started.mission.status).toBe("game_active");

    const completed = await transport.completeMission({
      missionId: 42,
      score: 8100,
      bossDamage: 100,
      durationMs: 90000,
      idempotencyKey: "complete-42",
    });
    expect(completed.xpAwarded).toBe(500);
    expect(completed.streakDays).toBe(4);

    const phoneMission = await transport.unlockPhoneMission({
      missionId: 42,
      idempotencyKey: "phone-42",
    });
    expect(phoneMission.status).toBe("phone_ready");
    expect(phoneMission.code).toBe("MISSION 042");
    expect(phoneMission.accountName).toBe("Westview Property Management");
    expect(transitions).toEqual([
      "game_active",
      "game_completed",
      "phone_ready",
    ]);
  });

  it("returns an explicit error when the task no longer exists", async () => {
    const transport = createTrpcBoreslayMissionTransport({
      api: {
        get: vi.fn(async () => null),
        transition: vi.fn(),
      },
    });

    await expect(transport.loadMission(999)).rejects.toThrow(/not found/i);
  });
});
