import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installPwaHeadTags } from "../client/src/game/pwa/installPwaHead";
import { ONBOARDING_QUESTIONS } from "./goldlineOnboarding";
import { legacyProductNoticeText, PRODUCT_NAME } from "./productIdentity";

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
      ["client", "src", "game", "GoldlineGameHome.tsx"],
      ["client", "src", "pages", "goldline", "GoldlineHome.tsx"],
      ["client", "src", "pages", "goldline", "ColosseumStageView.tsx"],
      ["client", "src", "pages", "goldline", "ColosseumLoading.tsx"],
      ["client", "src", "pages", "DayforgeLanding.tsx"],
      ["client", "src", "pages", "BoreslayLanding.tsx"],
      ["client", "src", "pages", "TerritoryPreview.tsx"],
    ]) {
      expect(read(...file), file.join("/")).toContain("PRODUCT_NAME");
    }

    const play = read("client", "src", "game", "GoldlineGameHome.tsx");
    expect(play).toContain("INSTALL {PRODUCT_NAME}");
    expect(play).toContain("Add {PRODUCT_NAME} to your Home Screen");
    expect(play).not.toContain("INSTALL GOLDLINE");
    expect(play).not.toContain("Add Goldline to your Home Screen");
    expect(play).toContain("THE ROUTE STAYS IN VIEW");
    expect(play).not.toContain("GOLDLINE IS WATCHING");
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
    expect(read("client", "src", "pages", "DayforgeLanding.tsx")).toContain(
      "document.title = PRODUCT_NAME"
    );
    expect(read("client", "src", "pages", "BoreslayLanding.tsx")).toContain(
      "document.title = PRODUCT_NAME"
    );
    expect(read("client", "src", "pages", "DayforgeLanding.tsx")).toContain(
      "DayForge turns nearby laundry opportunities into playable"
    );
    expect(read("client", "src", "pages", "BoreslayLanding.tsx")).toContain(
      "Play as Spark in BORESLAY"
    );
    expect(read("client", "src", "pages", "TerritoryPreview.tsx")).toContain(
      "document.title = `Map My Territory | ${PRODUCT_NAME}`"
    );
    expect(read("client", "src", "pages", "TerritoryPreview.tsx")).not.toContain(
      "Map My Territory | DayForge"
    );
  });

  it("states the legacy notice without treating a blank name as a product", () => {
    expect(legacyProductNoticeText(" BORESLAY ")).toBe(
      `BORESLAY is a legacy page. The product is ${PRODUCT_NAME}.`
    );
    expect(legacyProductNoticeText("   ")).toBe(
      `This is a legacy page. The product is ${PRODUCT_NAME}.`
    );
    expect(legacyProductNoticeText("DayForge")).not.toContain(
      "DayForge is the product"
    );
    expect(read("client", "src", "product", "LegacyProductNotice.tsx")).toContain(
      "legacyProductNoticeText(legacyName)"
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

  it("names the iOS install title JOYSTICK without editing the manifest link", () => {
    const tags: Array<{ name?: string; content?: string; rel?: string; href?: string }> = [];
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement() {
        const el: {
          name?: string;
          content?: string;
          rel?: string;
          href?: string;
          setAttribute: () => void;
          remove: () => void;
        } = {
          setAttribute() {},
          remove() {
            const index = tags.indexOf(el);
            if (index >= 0) tags.splice(index, 1);
          },
        };
        return el;
      },
      head: {
        appendChild(el: (typeof tags)[number]) {
          tags.push(el);
        },
      },
    };
    try {
      const cleanup = installPwaHeadTags();
      const appleTitle = tags.find(tag => tag.name === "apple-mobile-web-app-title");
      const manifest = tags.find(tag => tag.rel === "manifest");
      expect(appleTitle?.content).toBe(PRODUCT_NAME);
      expect(manifest?.href).toBe("/goldline.webmanifest");
      cleanup();
      expect(tags).toHaveLength(0);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  });

  it("does not take ownership of the manifest, Driver login, or LoginForm", () => {
    expect(read("shared", "productIdentity.ts")).not.toContain("webmanifest");
    expect(read("client", "src", "pages", "Driver.tsx")).not.toContain("PRODUCT_NAME");
    expect(read("client", "src", "components", "LoginForm.tsx")).not.toContain(
      "PRODUCT_NAME"
    );
    const app = read("client", "src", "App.tsx");
    const driverAt = app.indexOf("if (isDriverHost)");
    expect(driverAt).toBeGreaterThan(0);
    const driverBlock = app.slice(driverAt);
    expect(driverBlock).not.toContain("LegacyLandingFrame");
    expect(driverBlock).not.toContain("PRODUCT_NAME");
  });
});
