import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { LanternTerritoryReport } from "@shared/lanternTerritoryReport";
import { lanternSceneFor } from "@/admin/adminPaths";
import LanternReportPanel from "./LanternReportPanel";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      geographicTruth: {
        myAtlas: { useQuery: () => ({ data: { customers: [] }, isError: false, refetch: () => {} }) },
        territoryReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: () => {} }) },
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin", openId: "admin-owner" } }) }));
vi.mock("./islandBoard", () => ({ createIslandBoard: vi.fn() }));
vi.mock("./TowerFloors", () => ({ default: () => null }));
vi.mock("./ObjectiveMarksLayer", () => ({ default: () => null }));

const fixture: LanternTerritoryReport = {
  tenantId: "fixture",
  figuresAreLive: false,
  windowDays: 30,
  periodLabel: "the last 30 days",
  comparisonLabel: "the 30 days before that",
  status: "ready",
  reason: null,
  geographyBasis: "tenant_location",
  source: {
    bookStatus: "fresh",
    completeness: "complete",
    loadedSources: ["fixture"],
    failedSources: [],
    checkedAt: "2026-10-18T18:00:00.000Z",
    mayStateExact: false,
    notes: [],
  },
  comparison: {
    mostRecordedRevenue: { territoryId: "hollywood", name: "Hollywood", revenueCents: 12300, evidenceClass: "fresh" },
    steepestDecline: null,
    dormantOpportunities: [],
    insufficient: [{ territoryId: "fixture", name: "Fixture", reason: "Fixture only." }],
    withheldReason: null,
  },
  territories: [{
    id: "hollywood",
    name: "Hollywood",
    revenueCents: 12300,
    previousRevenueCents: 10000,
    revenueChangeCents: 2300,
    paidOrderCount: 2,
    activeCustomers: 1,
    dormantCustomers: 0,
    locatedCustomers: 1,
    direction: "up",
    directionReliable: true,
    evidenceNote: "Fixture paid orders.",
    customers: [{ identityKey: "fixture", displayName: "Fixture Customer", phone: "3105550100" }],
  }],
  unattributed: { revenueCents: 0, orderCount: 0 },
  ambiguous: { revenueCents: 0, orderCount: 0 },
  outsideService: { revenueCents: 0, orderCount: 0 },
  missingPaymentEvidence: { orderCount: 0, cents: 0 },
  partitionedRevenueCents: 12300,
};

describe("Lantern City report mode", () => {
  it("labels fixture figures and stays read-only", () => {
    const html = renderToStaticMarkup(createElement(LanternReportPanel, {
      report: fixture,
      isLoading: false,
      isError: false,
      windowDays: 30,
      onWindowDays: () => {},
      selectedId: "hollywood",
      onSelect: () => {},
      onOpenCustomer: () => {},
      onRetry: () => {},
    }));
    expect(html).toContain("Fixture figures — not live sales.");
    expect(html).toContain("Read only");
    expect(html).toContain("$123.00");
    expect(html).not.toMatch(/send message|approve plan|xp|streak|coin/i);
    expect(html).toContain("No comparable decline");
  });

  it("opens on Explore and still mounts the cozy Tin Can House path", async () => {
    const { default: LanternCityIslands } = await import("./LanternCityIslands");
    const html = renderToStaticMarkup(createElement(LanternCityIslands, { onOpenCustomer: () => {} }));
    expect(html).toContain('data-lantern-mode="explore"');
    expect(html).toContain(">Explore<");
    expect(html).toContain(">Report<");
    expect(html).not.toContain('data-lantern-report="open"');
    const source = readFileSync(new URL("./LanternCityIslands.tsx", import.meta.url), "utf8");
    expect(source).toContain("SmallComforts");
    expect(source).toContain("Tin Can House");
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake")).toBe("silverLake3d");
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake&walk=0")).toBe("v6");
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake", { legacySilverLake: true })).toBe("v6");
    expect(lanternSceneFor("/growth/lantern-city", "?scene=v6")).toBe("v6");
    expect(lanternSceneFor("/", "")).toBe("islands");
  });
});
