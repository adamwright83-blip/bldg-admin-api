import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kingdoms = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      goldlineKingdoms: { list: { useQuery: () => kingdoms.state } },
    },
  },
}));

import { lastValetChapterUnlocked, TenantUnlockedChapterGate } from "./TenantUnlockedChapterGate";

function render() {
  return renderToStaticMarkup(
    createElement(
      TenantUnlockedChapterGate,
      { locked: createElement("p", null, "LOCKED") },
      createElement("p", null, "CHAPTER")
    )
  );
}

describe("tenant chapter unlock gate", () => {
  beforeEach(() => {
    kingdoms.state = { data: undefined, isLoading: false, isError: false };
  });

  it("opens the chapter only when The Last Valet kingdom is not locked", () => {
    kingdoms.state.data = [
      { kingdomId: "kingdom-1", lanternCityStatus: "complete" },
      { kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "available" },
    ];
    expect(render()).toContain("CHAPTER");
    expect(render()).not.toContain("LOCKED");
  });

  it("sends the member away while the kingdom is locked, missing, or unreadable", () => {
    kingdoms.state.data = [{ kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "locked" }];
    expect(render()).toBe("<p>LOCKED</p>");
    kingdoms.state.data = [{ kingdomId: "kingdom-1", lanternCityStatus: "available" }];
    expect(render()).toBe("<p>LOCKED</p>");
    kingdoms.state = { data: undefined, isLoading: false, isError: true };
    expect(render()).toBe("<p>LOCKED</p>");
  });

  it("renders neither the chapter nor the exit while the kingdoms are loading", () => {
    kingdoms.state = { data: undefined, isLoading: true, isError: false };
    const html = render();
    expect(html).not.toContain("CHAPTER");
    expect(html).not.toContain("LOCKED");
  });

  it("exposes the same predicate both hosts rely on", () => {
    expect(lastValetChapterUnlocked(undefined)).toBe(false);
    expect(lastValetChapterUnlocked([{ kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "complete" }])).toBe(true);
  });
});
