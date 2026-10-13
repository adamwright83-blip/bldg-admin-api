import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

import { chooseStrategicPath, getActiveStrategicPath, _clearChoiceStore } from "./pathChoiceService";
import { registerStrategyPlay, _clearPlayAndOfferStore, type StrategyPlay } from "./playGenerator";

afterEach(() => {
  vi.unstubAllEnvs();
  _clearChoiceStore();
  _clearPlayAndOfferStore();
});

describe("strategy path choice durability", () => {
  it("does not claim an active choice in production when the DB cannot persist it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "false");

    const play = {
      id: "play_scoped_test",
      tenantId: "t1",
      status: "candidate",
      needsApprovalToRun: false,
    } as StrategyPlay;
    registerStrategyPlay(play);
    await expect(chooseStrategicPath({
      tenantId: "t1", playId: play.id, surface: "map",
    })).rejects.toThrow("without durable database availability");
    expect(getActiveStrategicPath("t1")).toBeNull();
    expect(play.status).toBe("candidate");
  });
});
