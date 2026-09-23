import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ONBOARDING_QUESTIONS } from "./goldlineOnboarding";
import { PRODUCT_NAME } from "./productIdentity";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts: string[]) =>
  readFileSync(path.join(root, ...parts), "utf8");

describe("JOYSTICK product identity", () => {
  it("names the platform JOYSTICK", () => {
    expect(PRODUCT_NAME).toBe("JOYSTICK");
  });

  it("uses that name as the document title", () => {
    expect(read("client", "index.html")).toContain(
      `<title>${PRODUCT_NAME}</title>`
    );
  });

  it("puts the platform name on admin, world, and operator chrome", () => {
    const admin = read("client", "src", "pages", "Admin.tsx");
    expect(admin).toContain(
      'tracking-widest uppercase">\n                {PRODUCT_NAME}'
    );
    expect(admin).toContain("Laundry Butler partner cost");

    const nav = read(
      "client",
      "src",
      "components",
      "admin",
      "control-room",
      "ControlRoomNav.tsx"
    );
    expect(nav).toContain("aria-label={`${PRODUCT_NAME} Admin home`}");
    expect(nav).toContain("<strong>{PRODUCT_NAME}</strong>");
    expect(nav).toContain('{ label: "Tower Wars", path: "/growth/tower-wars"');
    expect(nav).not.toContain("Tower<br />Wars");

    for (const file of [
      ["client", "src", "product", "ProductShell.tsx"],
      ["client", "src", "pages", "DayforgeOnboardingPage.tsx"],
      ["client", "src", "pages", "DayforgeLoginPage.tsx"],
      ["client", "src", "pages", "DayforgeInvitePage.tsx"],
      ["client", "src", "pages", "DayforgeSettingsPage.tsx"],
      ["client", "src", "pages", "DayforgeTodayPage.tsx"],
      ["client", "src", "pages", "DayforgeProofPage.tsx"],
      ["client", "src", "components", "goldline", "onboarding", "GoldlineOnboarding.tsx"],
      ["client", "src", "components", "goldline", "onboarding", "DemoAccess.tsx"],
      ["client", "src", "components", "goldline", "onboarding", "DesignPartnerWorld.tsx"],
      ["client", "src", "components", "admin", "control-room", "LanternCityHud.tsx"],
      [
        "client",
        "src",
        "components",
        "admin",
        "control-room",
        "LanternCitySceneV6",
        "LanternCityHUD.tsx",
      ],
      ["client", "src", "components", "admin", "control-room", "TowerSiege.tsx"],
      ["client", "src", "pages", "goldline", "GoldlineOverworld.tsx"],
      ["client", "src", "pages", "AdminHostApp.tsx"],
    ]) {
      expect(read(...file), file.join("/")).toContain("PRODUCT_NAME");
    }
  });

  it("clarifies legacy landings without rewriting them", () => {
    const app = read("client", "src", "App.tsx");
    expect(app).toContain('<LegacyLandingFrame legacyName="BORESLAY">');
    expect(app).toContain('<LegacyLandingFrame legacyName="DayForge">');
    expect(app).toContain("if (isBoreslayHost)");
    expect(app).toContain("return <BoreslayLandingRoute />");
    expect(read("client", "src", "pages", "BoreslayLanding.tsx")).not.toContain(
      "LegacyProductNotice"
    );
    expect(read("client", "src", "pages", "DayforgeLanding.tsx")).not.toContain(
      "LegacyProductNotice"
    );
  });

  it("leaves the first-run questions laundry-capable and non-vertical", () => {
    expect(ONBOARDING_QUESTIONS).toEqual([
      "What do you actually do all day?",
      "Where do you work?",
      "Where do your best customers come from?",
      "What's the part of the job you avoid?",
      "If one thing changed in the next 90 days, what would it be?",
    ]);
  });

  it("does not rename the web manifest", () => {
    const manifest = read("client", "public", "goldline.webmanifest");
    expect(manifest).toContain('"name": "Goldline"');
  });
});
