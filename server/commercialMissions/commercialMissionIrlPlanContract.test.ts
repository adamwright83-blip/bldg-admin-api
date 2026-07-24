import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plan = readFileSync(new URL("./commercialMissionIrlPlanService.ts", import.meta.url), "utf8");
const driverModel = readFileSync(new URL("../../client/src/components/driver/driverMissionModel.ts", import.meta.url), "utf8");
const game = readFileSync(new URL("./commercialMissionGameService.ts", import.meta.url), "utf8");

describe("canonical IRL mission contract", () => {
  it("builds six ordered companion levels on the canonical mission root", () => {
    for (const key of ["wardrobe", "print-shop", "mints", "coaching", "hotel", "debrief"])
      expect(plan).toContain(`key: "${key}"`);
    expect(plan).toContain('revealPolicy: "sequential"');
  });
  it("keeps staged/manual print truth and safety instructions explicit", () => {
    expect(plan).toContain("providerConnected: false");
    expect(plan).toContain("paymentCreated: false");
    expect(plan).toContain("Park before interacting with DayForge");
  });
  it("never promotes hardcoded demo buildings into a production sales target", () => {
    const productionFunction = driverModel.slice(driverModel.indexOf("export function deriveMissionTarget"));
    expect(productionFunction).not.toContain("DEMO_TARGET_CANDIDATES");
    expect(productionFunction).toContain("return resolveFallbackTarget");
    expect(driverModel).toContain("No verified sales stop available nearby");
  });
  it("creates durable dispatch only after the server game completion truth", () => {
    const completion = game.slice(game.indexOf("export async function completeCommercialMissionGame"));
    expect(completion.indexOf("dispatchCommercialMission")).toBeGreaterThan(completion.indexOf("Qualifying game result did not produce"));
    expect(completion).toContain('dispatchPolicy: "on_game_complete"');
  });
});
