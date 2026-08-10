import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coldCallService = readFileSync(
  new URL("./coldCallBurstService.ts", import.meta.url),
  "utf8"
);
const coldCallUi = readFileSync(
  new URL(
    "../../client/src/game/encounters/coldCall/ColdCallBurst.tsx",
    import.meta.url
  ),
  "utf8"
);
const scoutService = readFileSync(
  new URL("./expansionScoutService.ts", import.meta.url),
  "utf8"
);
const migration = readFileSync(
  new URL("../../drizzle/0052_goldline_run2_loop.sql", import.meta.url),
  "utf8"
);

describe("Goldline Run-2 boundary contracts", () => {
  it("reuses the real commercial call outcome system", () => {
    expect(coldCallService).toContain("recordCommercialMissionCallAttempt");
    expect(coldCallService).toContain("cold_call_logged");
    expect(coldCallService).not.toContain("Brightline Builders");
  });

  it("never times or grades a live human conversation", () => {
    expect(coldCallUi).toContain("LIVE CALL · NO GAME TIMER");
    expect(coldCallUi).toContain("Combo timing is paused");
    expect(coldCallUi).not.toContain("PERFECT ZONE");
    expect(coldCallUi).not.toContain("NOW CALLING TIMING");
  });

  it("keeps combo break free of business mutation", () => {
    const breakBody = coldCallService.slice(
      coldCallService.indexOf("export async function breakColdCallCombo")
    );
    expect(breakBody).toContain("combo: 0");
    expect(breakBody).not.toContain("commercialMissions)");
    expect(breakBody).not.toContain("delete(");
  });

  it("creates Scout missions only from persisted territory discoveries", () => {
    expect(scoutService).toContain("discoverLaundryTerritory");
    expect(scoutService).toContain("persistTerritoryScan");
    expect(scoutService).toContain("createCommercialMission");
    expect(scoutService).not.toMatch(
      /Brightline|Summit Capital|Ocean View Plaza|#112|#089|#203/
    );
  });

  it("persists compact Run-2 projections with scoped uniqueness", () => {
    expect(migration).toContain("uq_driver_cold_call_batch_mission");
    expect(migration).toContain("uq_driver_capability_scope");
    expect(migration).toContain("uq_driver_scout_candidate");
    expect(migration).not.toContain("companyName");
    expect(migration).not.toContain("phoneNumber");
  });
});
