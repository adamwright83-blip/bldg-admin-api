import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ESTABLISHING_MS,
  REDUCED_MS,
  TRAVERSAL_MS,
  classifyArrival,
  entityFromSearch,
  flipTransform,
  transitionDuration,
} from "./worldTransition";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("a transition is a claim about the same entity", () => {
  it("carries the building identity through the URL", () => {
    expect(entityFromSearch("?building=opus_la")).toBe("opus_la");
    expect(entityFromSearch("building=century_park_east")).toBe(
      "century_park_east"
    );
    expect(entityFromSearch("?other=1")).toBeNull();
    expect(entityFromSearch("")).toBeNull();
  });

  it("only plays a journey when one actually happened", () => {
    // Deep link / refresh: there is no source to fly from.
    expect(
      classifyArrival({ hasSourceRect: false, cameFromWorld: false, isBack: false })
    ).toBe("establishing");
    // Never reverse-animate from a place the user was never at.
    expect(
      classifyArrival({ hasSourceRect: false, cameFromWorld: false, isBack: true })
    ).toBe("establishing");
    expect(
      classifyArrival({ hasSourceRect: true, cameFromWorld: true, isBack: false })
    ).toBe("traversal");
    expect(
      classifyArrival({ hasSourceRect: true, cameFromWorld: true, isBack: true })
    ).toBe("reverse");
  });
});

describe("FLIP geometry places the entity where it already was", () => {
  const source = { left: 100, top: 200, width: 148, height: 188 };
  const dest = { left: 18, top: 152, width: 444, height: 564 };

  it("maps the destination back onto the source exactly", () => {
    const t = flipTransform(source, dest);
    expect(t).toContain(`translate(${source.left - dest.left}px, ${source.top - dest.top}px)`);
    const [sx, sy] = t
      .match(/scale\(([\d.]+), ([\d.]+)\)/)!
      .slice(1)
      .map(Number);
    expect(sx).toBeCloseTo(source.width / dest.width, 3);
    expect(sy).toBeCloseTo(source.height / dest.height, 3);
  });

  it("is identity when nothing moved", () => {
    const t = flipTransform(source, source);
    expect(t).toBe("translate(0px, 0px) scale(1.0000, 1.0000)");
  });
});

describe("timing respects the one-second law", () => {
  it("keeps a major traversal longer than an establishing shot", () => {
    expect(TRAVERSAL_MS).toBeGreaterThan(ESTABLISHING_MS);
  });

  it("collapses to a short identity-preserving move under reduced motion", () => {
    const t = { kind: "traversal" as const, reducedMotion: true };
    expect(transitionDuration(t)).toBe(REDUCED_MS);
    expect(REDUCED_MS).toBeLessThan(ESTABLISHING_MS);
  });

  it("uses the traversal duration in both directions", () => {
    expect(
      transitionDuration({ kind: "reverse", reducedMotion: false })
    ).toBe(TRAVERSAL_MS);
  });
});

describe("state commits first, camera follows", () => {
  const button = read("./CityTowerButton.tsx");
  const provider = read("./WorldTransitionProvider.tsx");
  const css = read("./admin-control-room.css");

  it("navigates immediately rather than waiting for the animation", () => {
    const beginAt = button.indexOf("begin({");
    const navAt = button.indexOf("onNavigate(`/growth/tower-wars");
    expect(beginAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(beginAt); // navigation is not gated behind a timer
    expect(button).not.toMatch(/setTimeout[^)]*onNavigate/);
  });

  it("lands in the truthful final state on any interruption", () => {
    expect(provider).toContain('window.addEventListener("pointerdown", land)');
    expect(provider).toContain('window.addEventListener("keydown", land)');
  });

  it("never fabricates a journey when there is no source", () => {
    expect(provider).toContain(
      "if (!destRect || !current.sourceRect) return null;"
    );
  });

  it("holds the HUD back until the building has arrived", () => {
    expect(css).toContain(".tw-arriving .tw-scoreboard");
    expect(css).toContain(".tw-piece.is-inbound .cb-art{opacity:0}");
  });

  it("honours reduced motion without removing continuity", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.wt-flyer\{transition-duration:160ms/
    );
  });
});

describe("same-entity routing survives the move", () => {
  const pipeline = read("../../../pages/CommercialPipelinePage.tsx");
  // The atlas surface now includes the same-place inspector it renders inline.
  const atlas = read("./LanternCityAtlas.tsx") + read("./WorldEntityInspector.tsx");

  it("selects the requested pipeline record, not merely the first one", () => {
    // Clicking a specific pursuit on the atlas previously landed you on whatever
    // record the server returned first.
    expect(pipeline).toContain('.get("pipeline")');
    expect(pipeline).toContain("item.id === requestedId");
    expect(pipeline).not.toContain(
      "if (selectedId === null && pipeline.data?.[0])"
    );
  });

  it("only falls back to the first record when no entity was requested", () => {
    expect(pipeline).toContain("if (requestedId !== null)");
    expect(pipeline).toContain("setSelectedId(requested?.id ?? null)");
    expect(pipeline).toContain("setSelectedId(pipeline.data[0].id)");
  });

  it("navigates client-side so in-memory state is not discarded", () => {
    expect(atlas).toContain("<Link");
    expect(atlas).not.toMatch(/<a\s+className="lc-open-customer"/);
  });

  it("rejects a malformed pipeline id rather than trusting it", () => {
    expect(pipeline).toContain("Number.isSafeInteger(parsed) && parsed > 0");
  });
});
