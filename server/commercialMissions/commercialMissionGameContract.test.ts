import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0037_commercial_mission_game_results.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./commercialMissionGameService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./commercialMissionRouter.ts", import.meta.url), "utf8");
const rally = readFileSync(
  new URL("../../client/src/components/boreslay-rally/RallyDemo.tsx", import.meta.url),
  "utf8",
);

describe("commercial mission BORESLAY production contract", () => {
  it("persists multiple attempts but only one qualifying result and reward per mission", () => {
    expect(migration).toContain("CREATE TABLE `commercial_mission_game_attempts`");
    expect(migration).toContain("CREATE TABLE `commercial_mission_game_results`");
    expect(migration).toContain("CREATE TABLE `commercial_mission_game_rewards`");
    expect(migration).toContain("CONSTRAINT `uq_commercial_game_results_tenant_mission` UNIQUE(`tenantId`,`missionId`)");
    expect(migration).toContain("CONSTRAINT `uq_commercial_game_rewards_tenant_mission` UNIQUE(`tenantId`,`missionId`)");
    expect(migration).not.toContain("UNIQUE(`tenantId`,`missionId`,`startedAt`)");
  });

  it("commits result, reward, mission completion, and phone unlock in one transaction", () => {
    const transaction = service.slice(service.indexOf("export async function completeCommercialMissionGame"));
    expect(transaction).toContain("db.transaction(async tx");
    expect(transaction).toContain("commercialMissionGameResults");
    expect(transaction).toContain("commercialMissionGameRewards");
    expect(transaction).toContain('toStatus: "game_completed"');
    expect(transaction).toContain('toStatus: "phone_ready"');
    expect(transaction).toContain('idempotencyKey: `phone-unlock:${input.missionId}`');
    expect(transaction).not.toContain("update(commercialMissionGameResults)");
  });

  it("derives tenant, actor, assignment, and game authority on the server", () => {
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("playerId: ctx.user.openId");
    expect(router).toContain("assertDriverCanReadMission");
    expect(router).not.toContain("actorType: z.");
  });

  it("wraps the existing Rally engine without introducing another canvas or replay dependency", () => {
    expect(rally).toContain("new RallyEngine");
    expect(rally).toContain("getReplayRecord()");
    expect(rally.match(/<canvas/g)).toHaveLength(1);
    expect(rally).toContain("gameAttemptId");
    expect(rally).not.toContain("localStorage");
  });
});
