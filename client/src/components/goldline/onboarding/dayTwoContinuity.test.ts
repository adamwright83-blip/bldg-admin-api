import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileLocalWorld, knownTerritoryIds } from "@shared/goldlineLocalWorld";
import type { WorldAnchor } from "@shared/goldlineOnboarding";

const read = (...parts: string[]) =>
  fs.readFileSync(path.resolve(import.meta.dirname, ...parts), "utf8");
const reveal = read("DesignPartnerWorld.tsx");
const driver = read("..", "..", "..", "pages", "Driver.tsx");
const dayPlan = read("..", "..", "..", "pages", "goldline", "GoldlineDayPlan.tsx");
const host = read("..", "..", "..", "pages", "AdminHostApp.tsx");

const anchor = (id: string, latitude: number, longitude: number, evidenceId: string | null): WorldAnchor => ({
  id,
  label: id,
  latitude,
  longitude,
  provenance: evidenceId ? "imported_evidence" : "geocoded_declaration",
  evidenceId,
});

describe("reveal shows real projections, never cinematic constants", () => {
  it("derives known/unmapped counts from evidence rather than a scripted number", () => {
    const topology = compileLocalWorld({
      tenantId: "laundry-farm",
      label: "Los Angeles, CA",
      // One declared service area plus two geocoded imported customers.
      anchors: [
        anchor("area", 34.05, -118.24, null),
        anchor("customer-1", 34.14, -118.35, "external-customer:1"),
        anchor("customer-2", 33.94, -118.4, "external-customer:2"),
      ],
      extentKm: 32,
    });
    const known = knownTerritoryIds(topology);
    // Territory count is deterministic from extent/anchors, not chosen for drama.
    expect(topology.territories.length).toBeGreaterThan(1);
    expect(compileLocalWorld({
      tenantId: "laundry-farm",
      label: "Los Angeles, CA",
      anchors: [
        anchor("area", 34.05, -118.24, null),
        anchor("customer-1", 34.14, -118.35, "external-customer:1"),
        anchor("customer-2", 33.94, -118.4, "external-customer:2"),
      ],
      extentKm: 32,
    })).toEqual(topology);
    // Only imported evidence lights a territory. The declared service area does not.
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThan(topology.territories.length);
    const declaredOnly = compileLocalWorld({
      tenantId: "phoenix", label: "Phoenix, AZ",
      anchors: [anchor("area", 33.45, -112.07, null)], extentKm: 32,
    });
    expect(knownTerritoryIds(declaredOnly)).toEqual([]);
  });

  it("renders the counts it computed instead of hardcoded copy", () => {
    expect(reveal).toContain("topology.territories.length");
    expect(reveal).toContain("known.length");
    expect(reveal).toContain("topology.territories.length-known.length");
    expect(reveal).not.toMatch(/8 TERRITORIES|3 KNOWN|5 UNMAPPED/);
    expect(reveal).toContain("topology.label");
    expect(reveal).not.toMatch(/LOS ANGELES|PHOENIX|ATLANTA/);
  });

  it("offers one primary mission CTA plus the operational portals", () => {
    expect(reveal).toContain("BEGIN MISSION");
    for (const portal of ["/new-order", "/customers", "/operations"])
      expect(reveal).toContain(portal);
    // No tutorial carousel.
    expect(reveal).not.toMatch(/carousel|slide \d|Next tip/i);
  });

  it("only shows holdings that carry resolved imported evidence", () => {
    expect(reveal).toContain('addressStatus==="resolved"');
    expect(reveal).toContain("Imported customer evidence");
    expect(reveal).toContain("holdings.length>0");
  });
});

describe("day two returns to the world, never to the interview", () => {
  it("routes a completed session to the persistent world instead of the questions", () => {
    expect(host).toContain('goldlineEntry.data?.session?.status === "COMPLETE"');
    expect(host).toContain("if (isWorldHome && designPartnerWorld)");
    expect(host).toContain("if (isTowerWars && designPartnerWorld)");
    // The interview only renders while the session is NOT complete.
    expect(host).toContain('goldlineEntry.data.session?.status !== "COMPLETE"');
    // The reveal is never mounted without the world and mission it dereferences.
    expect(host).toContain("goldlineEntry.data.session.world &&");
    expect(host).toContain("goldlineEntry.data.session.mission");
  });

  it("hands Driver back to the real controller once the first mission is resolved", () => {
    expect(driver).toContain("!firstMission.gameplayCompletedAt");
    expect(driver).toContain("<GoldlineDriverController />");
    // First mission retains its cargo control; the real Daily Line mounts the
    // hero cargo composition inside GoldlineDayPlan itself.
    expect(driver).toContain("<VehicleCargo />");
    expect(dayPlan).toContain('mode="hero"');
  });

  it("keeps an unfinished mission visible on return", () => {
    // An outcome without a resolved encounter still routes into the mission.
    expect(reveal).toContain("mission.gameplayCompletedAt?");
    expect(reveal).toContain("IS VULNERABLE");
    expect(reveal).toContain("THE CHRONICLE REMEMBERS");
  });
});
