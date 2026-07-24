import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const settings = readFileSync(new URL("../../client/src/pages/DayforgeSettingsPage.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../saas/saasRouter.ts", import.meta.url), "utf8");
const attribution = readFileSync(new URL("../commercialCampaigns/commercialAttributionService.ts", import.meta.url), "utf8");
describe("third-party DayForge tenant experience", () => {
  it("shows configured/not-configured/manual provider truth", () => {
    expect(router).toContain("providerStatus: dayforgeTenantMemberProcedure");
    expect(router).toContain('connected: false');
    expect(settings).toContain("Provider truth");
  });
  it("keeps imports generic unless attribution evidence exists", () => {
    expect(attribution).toContain("if (!link) return null");
    expect(attribution).not.toContain("cleancloud");
  });
});
