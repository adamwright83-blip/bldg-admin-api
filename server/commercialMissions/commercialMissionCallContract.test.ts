import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMERCIAL_MISSION_CALL_OUTCOMES } from "./commercialMissionCallService";

const routerSource = readFileSync(
  new URL("./commercialMissionRouter.ts", import.meta.url),
  "utf8"
);
const fieldSource = readFileSync(
  new URL("../../client/src/pages/CommercialSalesMission.tsx", import.meta.url),
  "utf8"
);
const activationSource = readFileSync(
  new URL("./commercialMissionActivationService.ts", import.meta.url),
  "utf8"
);

describe("commercial mission call and activation contract", () => {
  it("keeps grounded call outcomes explicit", () => {
    expect(COMMERCIAL_MISSION_CALL_OUTCOMES).toEqual([
      "no_answer",
      "left_voicemail",
      "spoke",
      "visit_booked",
      "not_a_fit",
      "contact_unavailable",
    ]);
  });

  it("persists call attempts through field-authorized mission procedures", () => {
    expect(routerSource).toContain("callAttempts: dayforgeMissionFieldProcedure");
    expect(routerSource).toContain("logCallAttempt: dayforgeMissionFieldProcedure");
    expect(routerSource).toContain("assertDriverCanReadMission");
  });

  it("never auto-dials and gates field preparation on a saved attempt", () => {
    expect(fieldSource).toContain("The app never dials automatically.");
    expect(fieldSource).toContain("href={`tel:${mission.account.decisionMaker.phone}`}");
    expect(fieldSource).toContain("disabled={busy || !callAttempts.data?.length}");
  });

  it("activates only an active field user and advances to game ready", () => {
    expect(activationSource).toContain('eq(dayforgeSaasMemberships.active, true)');
    expect(activationSource).toContain('eq(users.role, "driver")');
    expect(activationSource).toContain('toStatus: "selected"');
    expect(activationSource).toContain('toStatus: "game_ready"');
  });
});
