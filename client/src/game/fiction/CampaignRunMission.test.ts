import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CampaignRunMissionHost wiring", () => {
  const source = readFileSync(
    new URL("./CampaignRunMissionHost.tsx", import.meta.url),
    "utf8"
  );
  const mission = readFileSync(
    new URL("./CampaignRunMission.tsx", import.meta.url),
    "utf8"
  );
  const css = readFileSync(
    new URL("./CampaignRunMission.css", import.meta.url),
    "utf8"
  );

  it("reads mission state from the campaign run projection, not a local counter", () => {
    expect(source).toContain("system.campaignRuns.projection");
    expect(source).not.toContain("setTimeout");
    expect(source).not.toContain("setInterval");
    expect(source).toContain("presentCampaignRunArt");
    expect(source).toContain("progress.complete");
    expect(source).toContain("slots: progress.slots");
  });

  it("renders scene and node images from presented art, so prop updates change assets without a reload", () => {
    expect(mission).toContain("src={art.sceneSrc}");
    expect(mission).toContain("src={node.src}");
    expect(mission).not.toContain("window.location.reload");
    expect(source).not.toContain("window.location.reload");
  });

  it("does not invent desktop art or convert approved PNGs", () => {
    expect(mission).not.toMatch(/\.webp/);
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("object-fit: cover");
    expect(css).toContain("object-fit: contain");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).not.toMatch(/filter:\s*brightness/);
    expect(css).not.toContain("mix-blend-mode");
  });
});

describe("mobile surface wiring does not regress other missions", () => {
  const gameHome = readFileSync(
    new URL("../GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );
  const controller = readFileSync(
    new URL("../../pages/driver/GoldlineDriverController.tsx", import.meta.url),
    "utf8"
  );
  const dayPlan = readFileSync(
    new URL("../../pages/goldline/GoldlineDayPlan.tsx", import.meta.url),
    "utf8"
  );

  it("keeps the existing fiction-mission selector beside BIO CONTAINMENT", () => {
    expect(gameHome).toContain('data-testid="enter-fiction-mission"');
    expect(gameHome).toContain("GoldlineFictionMissionPanel");
    expect(gameHome).toContain('data-testid="enter-bio-containment-mission"');
    expect(gameHome).toContain("GoldlineCampaignRunMission");
    expect(gameHome).toContain("resolveFictionPackVisuals");
  });

  it("does not hardcode bio-containment filenames outside the visual registry", () => {
    expect(controller).not.toContain("bio-containment-mission-hero.png");
    expect(dayPlan).not.toContain("bio-containment-mission-icon.png");
    expect(controller).toContain("campaignRuns.listMine");
    expect(dayPlan).toContain("campaignRunCard");
  });

  it("does not change admin/desktop lantern-city or colosseum surfaces", () => {
    expect(gameHome).not.toContain("LanternCitySceneV6");
    expect(controller).not.toContain("GoldlineCampaignLibraryAdmin");
  });
});
