/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
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
    expect(routerSource).toContain("callAttempts: legacyDayforgeMissionFieldProcedure");
    expect(routerSource).toContain("logCallAttempt: legacyDayforgeMissionFieldProcedure");
    expect(routerSource).toContain("assertDriverCanReadMission");
  });

  it("never auto-dials and gates call missions on a saved attempt", () => {
    expect(fieldSource).toContain("The app never dials automatically.");
    expect(fieldSource).toContain("href={`tel:${mission.account.decisionMaker.phone}`}");
    expect(fieldSource).toContain("disabled={busy || (callRequired && !callAttempts.data?.length)}");
    expect(fieldSource).toContain('builderMetadata?.missionType !== "in_person"');
  });

  it("activates only an active field user and advances to game ready", () => {
    expect(activationSource).toContain('eq(legacyDayforgeSaasMemberships.active, true)');
    expect(activationSource).toContain('eq(users.role, "driver")');
    expect(activationSource).toContain('toStatus: "selected"');
    expect(activationSource).toContain('toStatus: "game_ready"');
  });
});
