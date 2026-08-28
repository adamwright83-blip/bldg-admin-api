import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { northDomainForPath } from "@/admin/adminPaths";
import { damageStateForRevenue } from "@/components/admin/control-room/TowerWars";
import { classifyLanternCustomer, resolveCustomerMapLocation } from "@/components/admin/control-room/LanternCityAtlas";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "AdminHostApp.tsx"), "utf8");
const homeSource = fs.readFileSync(path.resolve(import.meta.dirname, "AdminHome.tsx"), "utf8");
const appSource = fs.readFileSync(path.resolve(import.meta.dirname, "..", "App.tsx"), "utf8");
const navSource = fs.readFileSync(path.resolve(import.meta.dirname, "..", "components", "admin", "control-room", "ControlRoomNav.tsx"), "utf8");
const towerSource = fs.readFileSync(path.resolve(import.meta.dirname, "..", "components", "admin", "control-room", "TowerWars.tsx"), "utf8");

describe("Admin six-domain shell", () => {
  it("defines exactly the approved north domains and no Team domain", () => {
    for (const label of ["Home", "Operations", "Customers", "Growth", "Money", "Settings"]) expect(navSource).toContain(`label: "${label}"`);
    expect(navSource).not.toContain('domain: "team"');
    expect(appSource).not.toContain('<Route path="/team"');
  });

  it("infers domains from deep links", () => {
    expect(northDomainForPath("/home/exceptions")).toBe("home");
    expect(northDomainForPath("/intake")).toBe("operations");
    expect(northDomainForPath("/customers")).toBe("customers");
    expect(northDomainForPath("/growth/driver-intelligence/beacon")).toBe("growth");
    expect(northDomainForPath("/commercial-pipeline")).toBe("growth");
    expect(northDomainForPath("/pnl")).toBe("money");
    expect(northDomainForPath("/catalog")).toBe("settings");
  });

  it("defaults Growth to Lantern City and nests Driver Intelligence", () => {
    expect(source).toContain('navigate("/growth/lantern-city", { replace: true })');
    expect(navSource).toContain('path: "/growth/driver-intelligence"');
    expect(navSource).toContain('label: "Overlook — Scout"');
  });
});

describe("route and archive safety", () => {
  it("preserves all HELD Corporate deep links", () => {
    for (const route of ["/requests", "/job-cards", "/proposal-review", "/proposal-bootstrap", "/casting-sprint", "/mission-control", "/post-consent-plans"]) expect(appSource).toContain(`<Route path="${route}" component={AdminHostApp} />`);
  });

  it("registers new Growth routes and wraps existing growth pages", () => {
    for (const route of ["/growth/lantern-city", "/growth/tower-wars", "/growth/driver-intelligence", "/growth/buildings", "/growth/offers", "/commercial-pipeline", "/churn-radar", "/sales-intel"]) expect(appSource).toContain(`path="${route}"`);
  });

  it("keeps archived Level 4 lazy and out of active navigation", () => {
    expect(source).toContain("const ArchivedLevel4OffensiveHost = lazy");
    expect(navSource).not.toContain("Level 4");
  });
});

describe("truth-bound visual rules", () => {
  it("classifies lanterns deterministically from persisted recency status", () => {
    expect(classifyLanternCustomer({ recencyStatus: "active" } as never)).toBe("active");
    expect(classifyLanternCustomer({ recencyStatus: "warm" } as never)).toBe("active");
    expect(classifyLanternCustomer({ recencyStatus: "cooling" } as never)).toBe("dimming");
    expect(classifyLanternCustomer({ recencyStatus: "lapsed" } as never)).toBe("dark");
  });

  it("maps only confident customer locations", () => {
    expect(resolveCustomerMapLocation({ propertyGroup: "opus_la", address: "" } as never)?.neighborhood).toBe("Koreatown");
    expect(resolveCustomerMapLocation({ propertyGroup: "century_park_east", address: "" } as never)?.neighborhood).toBe("Century City");
    expect(resolveCustomerMapLocation({ propertyGroup: "unknown", address: "somewhere in Los Angeles" } as never)).toBeNull();
  });

  it("derives damage from relative revenue without invented scores", () => {
    expect(damageStateForRevenue(100, 100)).toBe("pristine");
    expect(damageStateForRevenue(70, 100)).toBe("cracked");
    expect(damageStateForRevenue(10, 100)).toBe("critical");
    expect(towerSource).toContain("Accumulated real order value");
    expect(towerSource).toContain("Attack threshold");
    expect(towerSource).toContain("Not configured");
    expect(towerSource).not.toMatch(/⚡|100\/100|Season 7|3,450/);
  });

  it("shows Clockhead and Collector only under authoritative conditions", () => {
    expect(homeSource).toContain("promiseRisk.length > 0");
    expect(homeSource).toContain("overdueFollowups.length > 0");
    expect(homeSource).toContain('item.kind === "follow_up" && item.urgency === "overdue"');
  });
});
