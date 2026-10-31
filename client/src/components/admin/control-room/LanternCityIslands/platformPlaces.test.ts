import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lanternSceneFor } from "@/admin/adminPaths";
import { silverLake3DHref } from "@/pages/goldline/silverLake3d/silverLakeEntry";
import { beverlyHills3DHref } from "@/pages/goldline/beverlyHills3d/beverlyHillsEntry";
import { isPlatformAdminPath } from "@shared/joystickHostRouting";
import { islandPlatformPlaces } from "./platformPlaces";

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
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "user", openId: "tenant-member" } }) }));
vi.mock("./islandBoard", () => ({ createIslandBoard: vi.fn() }));
vi.mock("./TowerFloors", () => ({ default: () => null }));
vi.mock("./ObjectiveMarksLayer", () => ({ default: () => null }));

import LanternCityIslands from "./LanternCityIslands";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("DEV", false);
});

describe("platform-only places on the island board", () => {
  it("are destinations only the platform admin shell can open", () => {
    // The hub enters a control-room path the customer host refuses.
    expect(isPlatformAdminPath("/operations/floor")).toBe(true);
    // The scene links are /growth/lantern-city with a query only AdminHostApp reads; JoystickWorld ignores it.
    const sceneOf = (href: string) => {
      const url = new URL(href, "https://app.gojoystick.com");
      return { path: url.pathname, scene: lanternSceneFor(url.pathname, url.search) };
    };
    expect(sceneOf(silverLake3DHref("silver-lake"))).toEqual({ path: "/growth/lantern-city", scene: "silverLake3d" });
    expect(sceneOf(beverlyHills3DHref())).toEqual({ path: "/growth/lantern-city", scene: "beverlyHills3d" });
    expect(sceneOf("/growth/lantern-city?level=channel-382")).toEqual({ path: "/growth/lantern-city", scene: "channel382" });
  });

  it("the platform admin board keeps the hub, both walk-ins and CHANNEL 382", () => {
    const places = islandPlatformPlaces(true);
    expect(places.operationsHub).toBe(true);
    expect(places.channel382).toBe(true);
    expect(places.walkIn("Silver Lake")).toBe("silverLake3d");
    expect(places.walkIn("Beverly Hills")).toBe("beverlyHills3d");
    expect(places.walkIn("Hollywood")).toBeNull();
    expect(places.walkIn(undefined)).toBeNull();
  });

  it("a tenant board builds no hub, opens Silver Lake and Beverly Hills as ordinary islands, and has no CHANNEL 382", () => {
    const places = islandPlatformPlaces(false);
    expect(places.operationsHub).toBe(false);
    expect(places.channel382).toBe(false);
    expect(places.walkIn("Silver Lake")).toBeNull();
    expect(places.walkIn("Beverly Hills")).toBeNull();
    expect(places.walkIn("Hollywood")).toBeNull();
  });

  it("LanternCityIslands shows the CHANNEL 382 button by default and not when platform scenes are off", () => {
    const platform = renderToStaticMarkup(createElement(LanternCityIslands, { onOpenCustomer: () => {} }));
    expect(platform).toContain('data-testid="lantern-channel-382"');

    const tenant = renderToStaticMarkup(createElement(LanternCityIslands, { onOpenCustomer: () => {}, platformScenes: false }));
    expect(tenant).not.toContain('data-testid="lantern-channel-382"');
    expect(tenant).not.toContain("CHANNEL 382");
    // the rest of the tenant board chrome is unchanged
    expect(tenant).toContain("LANTERN CITY");
    expect(tenant).toContain('aria-label="Lantern City mode"');
  });
});
