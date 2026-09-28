import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync(
  new URL("./missionSalesBriefRouter.ts", import.meta.url),
  "utf8"
);

describe("Claire pre-visit intel authorization", () => {
  it("applies the same field assignment gate before generating or returning intel", () => {
    const procedureStart = router.indexOf("preVisitIntel:");
    const procedureEnd = router.indexOf("// Admin/developer review tooling", procedureStart);
    expect(procedureStart).toBeGreaterThan(-1);
    expect(procedureEnd).toBeGreaterThan(procedureStart);

    const procedure = router.slice(procedureStart, procedureEnd);
    expect(procedure).toContain("getCommercialMission({");
    expect(procedure).toContain("assertDriverCanReadMission({");
    expect(procedure).toContain("userId: ctx.user.openId");
    expect(procedure).toContain('ctx.legacyDayforgeMembership.role !== "field"');

    const authIndex = procedure.indexOf("assertDriverCanReadMission({");
    const intelIndex = procedure.indexOf("getClairePreVisitIntel({");
    expect(authIndex).toBeGreaterThan(-1);
    expect(intelIndex).toBeGreaterThan(authIndex);
    expect(procedure).toContain("actorId: ctx.user.openId");
  });
});
