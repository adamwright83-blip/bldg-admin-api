import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./CommercialSalesMission.tsx", import.meta.url),
  "utf8"
);

describe("CommercialSalesMission Claire pre-visit intel", () => {
  it("reads the same server-built Claire loadout before the field encounter", () => {
    expect(page).toContain("missionSalesBrief.preVisitIntel.useQuery");
    expect(page).toContain('data-testid="csm-claire-previsit-intel"');
    expect(page).toContain("THREE THINGS BEFORE YOU GO IN");
    expect(page).toContain("intel.items.map");
  });

  it("keeps the dossier available through preparation and travel, before outcome", () => {
    const occurrences = page.match(/<ClaireTowerIntelPanel/g)?.length ?? 0;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(page).toContain('mission.status === "phone_ready"');
    expect(page).toContain('mission.status === "preparing"');
    expect(page).toContain('mission.status === "en_route"');
  });

  it("labels trainer provenance without pretending fallback advice came from Shelby", () => {
    expect(page).toContain('item.provenance.kind === "trainer_source"');
    expect(page).toContain("TRAINER SOURCE");
    expect(page).toContain("MISSION BRIEF · CLAIRE");
  });
});
