import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const login = readFileSync(new URL("../../client/src/pages/DayforgeLoginPage.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../../client/src/pages/DayforgeOnboardingPage.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../../client/src/pages/TerritoryPreview.tsx", import.meta.url), "utf8");
const authRoute = readFileSync(new URL("../saas/saasAuthRoute.ts", import.meta.url), "utf8");

describe("DayForge authenticated entry contract", () => {
  it("uses one resolver and never defaults normal login to the demo controller", () => {
    expect(login).toContain("resolveDayforgeAuthenticatedDestination");
    expect(login).not.toContain('window.location.assign("/julydemo")');
  });
  it("threads preview context through onboarding and activation", () => {
    expect(preview).toContain("/dayforge-onboarding?preview=");
    expect(onboarding).toContain("dayforge_onboarding_continuation");
    expect(onboarding).toContain('query.set("preview"');
  });
  it("requires active tenant membership before issuing a session", () => {
    expect(authRoute).toContain("!account.membershipActive");
    expect(authRoute).toContain('account.tenantStatus === "suspended"');
    expect(authRoute).toContain('account.tenantStatus === "canceled"');
  });
});
