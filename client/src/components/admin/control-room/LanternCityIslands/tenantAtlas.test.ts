import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  user: { role: "admin", openId: "admin-owner" },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { system: { geographicTruth: { myAtlas: { useQuery: mocks.query } } } },
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
