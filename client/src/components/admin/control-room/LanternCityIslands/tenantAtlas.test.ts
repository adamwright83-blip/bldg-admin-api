import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  user: { role: "admin", openId: "admin-owner" },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      geographicTruth: {
        myAtlas: { useQuery: mocks.query },
        territoryReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: () => {} }) },
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("./islandBoard", () => ({ createIslandBoard: vi.fn() }));
vi.mock("./TowerFloors", () => ({ default: () => null }));
vi.mock("./ObjectiveMarksLayer", () => ({ default: () => null }));
import LanternCityIslands from "./LanternCityIslands";
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("DEV", false);
  mocks.query.mockReset();
});
describe("normal tenant Islands atlas", () => {
  it("legacy admin UI uses only myAtlas without any target-tenant input", () => {
    mocks.query.mockReturnValue({
      data: { customers: [] },
      isError: false,
      refetch: vi.fn(),
    });
    expect(() =>
      renderToStaticMarkup(
        createElement(LanternCityIslands, { onOpenCustomer: () => {} })
      )
    ).not.toThrow();
    expect(mocks.query).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: true })
    );
  });
  it("an atlas authorization failure is unavailable, never a truthful empty world or sample", () => {
    mocks.query.mockReturnValue({
      isError: true,
      error: new Error("FORBIDDEN"),
      refetch: vi.fn(),
    });
    const html = renderToStaticMarkup(
      createElement(LanternCityIslands, { onOpenCustomer: () => {} })
    );
    expect(html).toContain('data-lantern-state="atlas-unavailable"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("Sample customers");
    expect(html).not.toContain("0 lanterns");
  });
  it("loading has an explicit state while customer truth is unknown", () => {
    mocks.query.mockReturnValue({ isError: false, refetch: vi.fn() });
    const html = renderToStaticMarkup(
      createElement(LanternCityIslands, { onOpenCustomer: () => {} })
    );
    expect(html).toContain('data-lantern-state="loading"');
  });
});

describe("Islands never presents a mapping gap as zero customers", () => {
  const cust = (n: number, located: boolean) =>
    Array.from({ length: n }, (_, i) => ({
      identityKey: `c${i}`, displayName: `C${i}`, phone: null,
      cadence: { state: "active", daysSinceLastOrder: 1 },
      location: located ? { latitude: 34.1, longitude: -118.3, x: 1, y: 1, outOfBounds: false, canonicalAddress: "x" } : null,
    }));
  const render = (data: unknown, extra: Record<string, unknown> = {}) => {
    mocks.query.mockReturnValue({ data, isError: false, refetch: vi.fn(), ...extra });
    return renderToStaticMarkup(createElement(LanternCityIslands, { onOpenCustomer: () => {} }));
  };
  it("N customers, 0 located: says mapping gap and shows the customer count", () => {
    const html = render({ customers: cust(93, false), statusCounts: { pending: 93 } });
    expect(html).toContain("mapping-unmapped");
    expect(html).toContain("93 customers are on record");
    expect(html).toContain("not an empty business");
  });
  it("some located: partial notice, no all-clear claim", () => {
    const html = render({ customers: [...cust(3, true), ...cust(2, false).map((c, i) => ({ ...c, identityKey: `u${i}` }))], statusCounts: {} });
    expect(html).toContain("mapping-partial");
    expect(html).toContain("2 of 5 customers have no map location");
  });
  it("genuinely zero customers shows no mapping warning", () => {
    const html = render({ customers: [], statusCounts: {} });
    expect(html).not.toContain("mapping-");
  });
  it("query error is the unavailable state, not zero", () => {
    const html = render(undefined, { isError: true });
    expect(html).toContain("atlas-unavailable");
    expect(html).not.toContain("mapping-");
  });
});
