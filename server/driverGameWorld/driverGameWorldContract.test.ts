import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  new URL("./driverGameWorldService.ts", import.meta.url),
  "utf8"
);
const migration = readFileSync(
  new URL("../../drizzle/0051_driver_game_world.sql", import.meta.url),
  "utf8"
);
const game = readFileSync(
  new URL("../../client/src/game/GoldlineGameHome.tsx", import.meta.url),
  "utf8"
);
const migrationVerifier = readFileSync(
  new URL("../../scripts/dayforge-migrations-verify.ts", import.meta.url),
  "utf8"
);

describe("playable driver world contract", () => {
  it("stores only compact tenant-scoped visual projection", () => {
    expect(migration).toContain("driver_game_world_nodes");
    expect(migration).toContain("tenantId");
    expect(migration).toContain("missionId");
    expect(migration).toContain("visualState");
    expect(migration).not.toContain("companyName");
    expect(migration).not.toContain("contractValue");
  });

  it("verifies the post-journal 0051 schema through information_schema", () => {
    expect(migrationVerifier).toContain('migration: "0051_driver_game_world"');
    expect(migrationVerifier).toContain('table: "driver_game_world_nodes"');
    expect(migrationVerifier).toContain(
      'index: "uq_driver_game_world_actor_mission"'
    );
    expect(migrationVerifier).toContain(
      'columns: ["tenantId", "actorId", "missionId"]'
    );
    expect(migrationVerifier).toContain('column: "laraBriefing"');
    expect(migrationVerifier).toContain("information_schema.statistics");
  });

  it("allows recovery only from a real follow-up and never from closure", () => {
    expect(service).toContain('node.missionStatus === "lost"');
    expect(service).toContain('node.missionStatus !== "follow_up"');
    expect(service).toContain("A real follow-up must exist");
    expect(service).toContain(
      'if (node.visualState === "recovery_active") return node'
    );
    expect(service).toContain('visualState: "recovery_active"');
  });

  it("keeps direct weak-point input separate from business resolution", () => {
    expect(game).toContain("WEAK POINT · TAP / FLICK ABILITY");
    expect(game).toContain("ARCADE BREACH ≠ BUSINESS WIN");
    expect(game).toContain("LOG REAL RESULT");
    expect(game).not.toContain("DEPLOY");
    expect(game).not.toContain("Brightline");
    expect(game).not.toContain("Summit Capital");
  });

  it("keeps future Cold Call Burst and Scout unlock out of this run", () => {
    expect(game).not.toContain("CHAIN TARGET");
    expect(game).not.toContain("NEW CHARACTER UNLOCKED");
    expect(game).not.toContain("COMBO x3");
  });
});
