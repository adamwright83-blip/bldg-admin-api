import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { northDomainForPath } from "@/admin/adminPaths";
import { damageStateForIncomingAttacks } from "@/components/admin/control-room/TowerWars";
import {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
} from "@/components/admin/control-room/LanternCityAtlas";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "AdminHostApp.tsx"),
  "utf8"
);
const homeSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "AdminHome.tsx"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "App.tsx"),
  "utf8"
);
const navSource = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "components",
    "admin",
    "control-room",
    "ControlRoomNav.tsx"
  ),
  "utf8"
);
const towerSource = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "components",
    "admin",
    "control-room",
    "TowerWars.tsx"
  ),
  "utf8"
);

describe("Admin six-domain shell", () => {
  it("defines exactly the approved north domains and no Team domain", () => {
    for (const label of [
      "Home",
      "Operations",
      "Customers",
      "Growth",
      "Money",
      "Settings",
    ])
      expect(navSource).toContain(`label: "${label}"`);
    expect(navSource).not.toContain('domain: "team"');
    expect(appSource).not.toContain('<Route path="/team"');
  });

  it("infers domains from deep links", () => {
    expect(northDomainForPath("/home/exceptions")).toBe("home");
    expect(northDomainForPath("/intake")).toBe("operations");
    expect(northDomainForPath("/customers")).toBe("customers");
    expect(northDomainForPath("/growth/driver-intelligence/beacon")).toBe(
      "growth"
    );
    expect(northDomainForPath("/commercial-pipeline")).toBe("growth");
    expect(northDomainForPath("/pnl")).toBe("money");
    expect(northDomainForPath("/catalog")).toBe("settings");
  });

  it("defaults Growth to Lantern City and nests Driver Intelligence", () => {
    expect(source).toContain(
      'navigate("/growth/lantern-city", { replace: true })'
    );
    expect(navSource).toContain('path: "/growth/driver-intelligence"');
    expect(navSource).toContain('label: "Overlook — Scout"');
  });

  it("keeps completed design-partner sessions from replacing the canonical world", () => {
    expect(source).not.toContain("DesignPartnerWorld");
    expect(source).toContain('aria-label="Lantern City world home"');
    expect(source).toContain("<LanternCityAtlas");
    expect(source).toContain("isTowerWars ? (");
    expect(source).toContain("<TowerWars onNavigate=");
    expect(source).toContain('goldlineEntry.data.session?.status !== "COMPLETE"');
  });

  it("shows the sandbox route only from the server-authoritative capability", () => {
    expect(source).toContain("towerWars.sandboxCapability.useQuery");
    expect(source).toContain("sandboxEnabled={sandboxCapability.data?.enabled === true}");
    expect(navSource).toContain('item.path !== "/growth/sandbox"');
  });
});

describe("Admin Home battle truth", () => {
  it("derives pressure and revenue cues from Tower Wars today, not customer penetration", () => {
    // Pressure comes from real TODAY Tower Wars revenue, never from customer
    // penetration counts. The assertions below name the product law rather than
    // an incidental spelling: an earlier assertion pinned the literal string
    // `pressureBuilding === "opus_la"`, which the correct implementation stopped
    // containing once the comparison became a ternary — a passing/failing signal
    // that tracked source formatting instead of truth.
    expect(homeSource).toContain("towerWars.today.useQuery");
    // The loser is the LOWER actual revenue.
    expect(homeSource).toContain("opusRevenue < cpeRevenue");
    // A tie — including $0/$0 — yields no loser at all.
    expect(homeSource).toContain("opusRevenue !== cpeRevenue");
    // Both sides must be known before any pressure is claimed.
    expect(homeSource).toContain(
      "const pressureBuilding = opusRevenue !== null && cpeRevenue !== null"
    );
    // A new real ledger event drives the temporary revenue cue.
    expect(homeSource).toContain("newest.buildingId");
    // Penetration counts may travel as context, but never as the pressure source.
    expect(homeSource).not.toMatch(/pressureBuilding\s*=\s*[^;]*penetration/i);
  });
});

describe("route and archive safety", () => {
  it("preserves all HELD Corporate deep links", () => {
    for (const route of [
      "/requests",
      "/job-cards",
      "/proposal-review",
      "/proposal-bootstrap",
      "/casting-sprint",
      "/mission-control",
      "/post-consent-plans",
    ])
      expect(appSource).toContain(
        `<Route path="${route}" component={AdminHostApp} />`
      );
  });

  it("registers new Growth routes and wraps existing growth pages", () => {
    for (const route of [
      "/growth/lantern-city",
      "/growth/tower-wars",
      "/growth/driver-intelligence",
      "/growth/buildings",
      "/growth/offers",
      "/commercial-pipeline",
      "/churn-radar",
      "/sales-intel",
    ])
      expect(appSource).toContain(`path="${route}"`);
  });

  it("keeps archived Level 4 lazy and out of active navigation", () => {
    expect(source).toContain("const ArchivedLevel4OffensiveHost = lazy");
    expect(navSource).not.toContain("Level 4");
  });
});

describe("truth-bound visual rules", () => {
  it("classifies lanterns from customer-specific order cadence", () => {
    expect(
      inferCustomerCadence({
        qualifyingOrderDates: ["2026-08-01", "2026-08-08", "2026-08-15"],
        today: "2026-08-30",
        sparseFallback: "active",
      }).state
    ).toBe("dimming");
  });

  it("projects real coordinates instead of address-regex neighborhoods", () => {
    const projected = projectLatLngToLanternAtlas({
      latitude: 34.0537,
      longitude: -118.4134,
    });
    expect(projected.outOfBounds).toBe(false);
    expect(towerSource).not.toContain("resolveCustomerMapLocation");
  });

  it("derives damage from real incoming strikes and exposes replay", () => {
    expect(damageStateForIncomingAttacks(0)).toBe("pristine");
    expect(damageStateForIncomingAttacks(2)).toBe("cracked");
    expect(damageStateForIncomingAttacks(4)).toBe("critical");
    expect(towerSource).toContain("Replay this season");
    expect(towerSource).toContain("TOWER_WARS_ATTACK_THRESHOLD_CENTS");
    expect(towerSource).toContain("promise.id === printPromiseId");
    expect(towerSource).toContain("flushSync");
    expect(towerSource).not.toContain("Not configured");
    expect(towerSource).not.toMatch(/⚡|100\/100|Season 7|3,450/);
  });

  it("uses the dimensional OPUS LA and Century Park East assets on Tower Wars and Home", () => {
    // Both surfaces now render CanonicalBuildingArt, so a building cannot show a
    // different weapon depending on which screen you are on. Home previously used
    // opus-la-siege-driver-v5 (old composite with a thin baked club) while Tower
    // Wars used the plate plus the current driver overlay.
    expect(towerSource).toContain("CanonicalBuildingArt");
    // Home renders the same composition through CityTowerButton.
    expect(homeSource).toContain("CityTowerButton");
    for (const retired of [
      "opus-la-siege-driver-v5.png",
      "century-bazooka-optimized.png",
      "century-park-east-tower-v2.png",
      "opus-la-tower-v2.png",
    ]) {
      expect(towerSource).not.toContain(retired);
      expect(homeSource).not.toContain(retired);
    }
    expect(towerSource).not.toContain('className="tw-opus-art"');
    expect(towerSource).not.toContain("tw-opus-ball");
    expect(towerSource).toContain("settlement.sides");
  });

  it("shows Clockhead and Collector only under authoritative conditions", () => {
    expect(homeSource).toContain("promiseRisk.length > 0");
    expect(homeSource).toContain("overdueFollowups.length > 0");
    expect(homeSource).toContain(
      'item.kind === "follow_up" && item.urgency === "overdue"'
    );
  });
});
