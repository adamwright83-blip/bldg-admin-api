import { describe, expect, it, vi } from "vitest";
import { DEMO_MISSION } from "@shared/commercialMission";
import {
  ProductionBoreslayMissionAdapter,
  type BoreslayMissionTransport,
} from "./ProductionBoreslayMissionAdapter";

function transport(): BoreslayMissionTransport {
  return {
    loadMission: vi.fn(async () => ({ ...DEMO_MISSION, status: "game_ready" })),
    startMission: vi.fn(async ({ idempotencyKey }) => ({
      mission: { ...DEMO_MISSION, status: "game_active" },
      startedAt: "2026-07-12T10:00:00.000Z",
      idempotencyKey,
    })),
    completeMission: vi.fn(async () => ({
      mission: { ...DEMO_MISSION, status: "game_completed" },
      completedAt: "2026-07-12T10:02:00.000Z",
      xpAwarded: 500,
      streakDays: 3,
      phoneMissionReady: false,
    })),
    unlockPhoneMission: vi.fn(async () => ({
      ...DEMO_MISSION,
      status: "phone_ready",
    })),
    recordAbandonment: vi.fn(async () => undefined),
  };
}

describe("ProductionBoreslayMissionAdapter", () => {
  it("deduplicates concurrent mission starts", async () => {
    const fake = transport();
    const adapter = new ProductionBoreslayMissionAdapter(fake);

    const [first, second] = await Promise.all([
      adapter.start(DEMO_MISSION.id),
      adapter.start(DEMO_MISSION.id),
    ]);

    expect(first.startedAt).toBe(second.startedAt);
    expect(fake.startMission).toHaveBeenCalledTimes(1);
  });

  it("unlocks the same mission for the phone after game completion", async () => {
    const fake = transport();
    const adapter = new ProductionBoreslayMissionAdapter(fake);
    await adapter.start(DEMO_MISSION.id);

    const result = await adapter.complete({
      missionId: DEMO_MISSION.id,
      score: 8200,
      bossDamage: 100,
      durationMs: 118000,
    });

    expect(result.phoneMissionReady).toBe(true);
    expect(result.mission.code).toBe(DEMO_MISSION.code);
    expect(result.mission.accountName).toBe(DEMO_MISSION.accountName);
    expect(result.mission.status).toBe("phone_ready");
    expect(fake.completeMission).toHaveBeenCalledTimes(1);
    expect(fake.unlockPhoneMission).toHaveBeenCalledTimes(1);
  });

  it("does not award completion twice", async () => {
    const fake = transport();
    const adapter = new ProductionBoreslayMissionAdapter(fake);
    await adapter.start(DEMO_MISSION.id);

    const input = {
      missionId: DEMO_MISSION.id,
      score: 8200,
      bossDamage: 100,
      durationMs: 118000,
    };
    const first = await adapter.complete(input);
    const second = await adapter.complete(input);

    expect(second).toEqual(first);
    expect(fake.completeMission).toHaveBeenCalledTimes(1);
  });
});
