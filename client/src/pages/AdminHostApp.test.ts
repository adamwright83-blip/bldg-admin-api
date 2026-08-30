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
    expect(towerSource).toContain("Replay Today");
    expect(towerSource).toContain("TOWER_WARS_ATTACK_THRESHOLD_CENTS");
    expect(towerSource).toContain("promise.id === printPromiseId");
    expect(towerSource).toContain("flushSync");
    expect(towerSource).not.toContain("Not configured");
    expect(towerSource).not.toMatch(/⚡|100\/100|Season 7|3,450/);
  });

  it("uses the dimensional OPUS LA and Century Park East assets on Tower Wars and Home", () => {
    for (const asset of [
      "opus-la-tower-v2.png",
      "century-park-east-tower-v2.png",
    ])
      expect(towerSource).toContain(asset);
    expect(homeSource).toContain("opus-la-siege-driver-v5.png");
    expect(homeSource).toContain("century-park-east-tower-v2.png");
    expect(towerSource).not.toContain('className="tw-opus-art"');
  });

  it("shows Clockhead and Collector only under authoritative conditions", () => {
    expect(homeSource).toContain("promiseRisk.length > 0");
    expect(homeSource).toContain("overdueFollowups.length > 0");
    expect(homeSource).toContain(
      'item.kind === "follow_up" && item.urgency === "overdue"'
    );
  });
});
