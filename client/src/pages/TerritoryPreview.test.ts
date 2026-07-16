import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./TerritoryPreview.tsx", import.meta.url),
  "utf8"
);
const styles = readFileSync(
  new URL("./territory-preview.css", import.meta.url),
  "utf8"
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const landing = readFileSync(
  new URL("./LandingFinal.tsx", import.meta.url),
  "utf8"
);
const landingAnalytics = readFileSync(
  new URL("./dayforge-flagship/analytics.ts", import.meta.url),
  "utf8"
);

describe("DayForge public territory preview UI contract", () => {
  it("uses the resumable server session for every preview action", () => {
    expect(page).toContain("publicTerritory.start.useMutation");
    expect(page).toContain("publicTerritory.execute.useMutation");
    expect(page).toContain("publicTerritory.status.useMutation");
    expect(page).toContain("window.setTimeout(poll, 1_500)");
    expect(page).not.toContain("publicTerritory.status.useQuery");
    expect(page).toContain("publicTerritory.openOpportunity.useMutation");
    expect(page).toContain("publicTerritory.createSampleMission.useMutation");
    expect(page).toContain("publicTerritory.convertPreview.useMutation");
    expect(page).toContain("sessionStorage");
    expect(page).not.toContain("DEMO_OPPORTUNITIES");
    expect(page).not.toContain("COMMERCIAL_MISSION_DEMO_STORAGE_KEY");
  });

  it("renders honest status, provenance, and preview-only mission boundaries", () => {
    expect(page).toContain('status === "running"');
    expect(page).toContain('status === "failed"');
    expect(page).toContain('status === "expired"');
    expect(page).toContain("Sourced fact");
    expect(page).toContain("Operator input");
    expect(page).toContain("Estimate");
    expect(page).toContain("AI inference");
    expect(page).toContain("NON-PERSISTED SAMPLE");
    expect(page).toContain("tenant mission is created");
  });

  it("keeps the map and list selectable and exposes release selectors", () => {
    expect(page).toContain("Opportunity map");
    expect(page).toContain("onSelect={selectOpportunity}");
    expect(page).toContain('data-testid="dayforge-territory-preview"');
    expect(page).toContain('data-testid="territory-preview-results"');
    expect(page).toContain('data-testid="territory-sample-mission"');
  });

  it("is lazy-routed on public and admin preview hosts", () => {
    expect(app).toContain('lazy(() => import("./pages/TerritoryPreview"))');
    expect(app.match(/path="\/territory-preview"/g)).toHaveLength(2);
  });

  it("changes only landing CTA behavior and uses privacy-hardened analytics", () => {
    expect(landing).toContain(
      'new URL("/territory-preview", window.location.origin)'
    );
    expect(landing).toContain(
      'destination.searchParams.set("placement", source)'
    );
    expect(landingAnalytics).toContain("autocapture: false");
    expect(landingAnalytics).toContain("disable_session_recording: true");
    expect(landingAnalytics).toContain('person_profiles: "never"');
  });

  it("includes responsive, focus-visible, and reduced-motion behavior", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
