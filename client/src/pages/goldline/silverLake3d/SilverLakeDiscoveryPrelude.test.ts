import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import SilverLakeDiscoveryPrelude, { discoveryEvidence } from "./SilverLakeDiscoveryPrelude";

function neighbor(id: string, days: number): CozyProjectedTarget {
  return {
    customerId: id,
    displayName: "Neighbor " + id,
    daysSinceLastOrder: days,
  } as CozyProjectedTarget;
}

const callbacks = { onClose: () => {}, onSelect: (_t: CozyProjectedTarget) => {} };

function render(
  targets: readonly CozyProjectedTarget[],
  options: Partial<Parameters<typeof SilverLakeDiscoveryPrelude>[0]> = {}
) {
  return renderToStaticMarkup(createElement(SilverLakeDiscoveryPrelude, {
    targets, synthetic: false, loading: false, loadFailed: false,
    withheldReason: null, focusMissing: false, ...callbacks, ...options,
  })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("Claire's played-in-the-real-courtyard Silver Lake introduction", () => {
  it("shows projected count, not a made-up revenue decrease or causal claim", () => {
    const html = render([neighbor("one", 68), neighbor("two", 99)]);
    expect(html).toContain("2");
    expect(html).toContain("99 days");
    expect(html).not.toContain("12%");
    expect(html).not.toContain("caused");
    expect(html).not.toContain("sent");
    expect(html).toContain("Show me");
  });

  it("never infers zero customers from an unavailable ledger", () => {
    const html = render([], { loadFailed: true });
    expect(html).toContain("customer records are unavailable");
    expect(html).not.toContain("no customers");
    expect(html).toContain("Explore anyway");
  });

  it("retains the server's withheld explanation", () => {
    const html = render([], { withheldReason: "CleanCloud receipt is not fresh" });
    expect(html).toContain("CleanCloud receipt is not fresh");
    expect(html).not.toContain("No one to reconnect");
  });

  it("keeps synthetic preview explicitly separate from live evidence and sends nothing", () => {
    const html = render([neighbor("demo", 60)], { synthetic: true });
    expect(html).toContain("Story preview");
    expect(html).toContain("Nothing will be sent");
    expect(html).toContain('data-evidence="synthetic"');
  });

  it("does not multiply the original eligible target count or invent a customer", () => {
    const items = [neighbor("a", 40), neighbor("b", 66), neighbor("c", 90), neighbor("d", 105)];
    expect(discoveryEvidence(items)).toEqual({
      count: 4,
      oldestDays: 105,
      candidates: items.slice(0, 3),
    });
    expect(discoveryEvidence([])).toEqual({ count: 0, candidates: [], oldestDays: null });
  });

  it("does not present an empty focus as confirmed dormancy", () => {
    const html = render([], { focusMissing: true });
    expect(html).toContain("hasn't chosen Silver Lake");
    expect(html).toContain("Take a walk");
  });

  it("keeps the current route visible while source data is loading", () => {
    const html = render([], { loading: true });
    expect(html).toContain("Reading the evidence");
    expect(html).toContain("There's something I want to check.");
    expect(html).not.toContain("0 neighbors");
  });
});
