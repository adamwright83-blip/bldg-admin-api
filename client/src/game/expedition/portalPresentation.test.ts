import { describe, expect, it } from "vitest";
import {
  corridorGateVisibleDuring,
  portalGlowAlpha,
  portalPresentationFor,
} from "./portalPresentation";

/**
 * The regression half matters as much as the fix: suppressing the portal
 * card during an expedition must not change ordinary corridor behaviour.
 */

describe("normal corridor behaviour is preserved", () => {
  it("still draws the comms portal card outside an expedition", () => {
    expect(
      portalPresentationFor({
        expeditionActive: false,
        anchorType: "comms_portal",
        hasCardTexture: true,
      })
    ).toBe("card");
  });

  it("keeps the existing ambient fallback when the texture is missing", () => {
    expect(
      portalPresentationFor({
        expeditionActive: false,
        anchorType: "comms_portal",
        hasCardTexture: false,
      })
    ).toBe("ambient");
  });

  it("leaves non-comms anchors ambient exactly as before", () => {
    expect(
      portalPresentationFor({
        expeditionActive: false,
        anchorType: "stronghold",
        hasCardTexture: true,
      })
    ).toBe("ambient");
  });

  it("uses the original glow strengths outside an expedition", () => {
    expect(portalGlowAlpha({ expeditionActive: false, dominance: 0 })).toEqual({
      outer: 0.05,
      inner: 0.08,
    });
    const full = portalGlowAlpha({ expeditionActive: false, dominance: 1 });
    expect(full.outer).toBeCloseTo(0.15, 10);
    expect(full.inner).toBeCloseTo(0.22, 10);
  });
});

describe("during an active expedition the world is not covered", () => {
  it("never draws the card, even with the texture loaded", () => {
    expect(
      portalPresentationFor({
        expeditionActive: true,
        anchorType: "comms_portal",
        hasCardTexture: true,
      })
    ).toBe("ambient");
  });

  it("dials the glow well below the normal corridor strength", () => {
    const expedition = portalGlowAlpha({ expeditionActive: true, dominance: 1 });
    const normal = portalGlowAlpha({ expeditionActive: false, dominance: 1 });

    expect(expedition.outer).toBeLessThan(normal.outer);
    expect(expedition.inner).toBeLessThan(normal.inner);
    // Still visible as light on stone, never fully invisible.
    expect(expedition.outer).toBeGreaterThan(0);
    expect(expedition.inner).toBeGreaterThan(0);
  });

  it("scales with proximity so the anchor is still findable", () => {
    const near = portalGlowAlpha({ expeditionActive: true, dominance: 1 });
    const far = portalGlowAlpha({ expeditionActive: true, dominance: 0 });
    expect(near.outer).toBeGreaterThan(far.outer);
  });
});

describe("corridor gate panel", () => {
  it("renders normally outside an expedition", () => {
    expect(corridorGateVisibleDuring({ expeditionActive: false })).toBe(true);
  });

  it("is hidden while the expedition owns the world", () => {
    // Confirmed by scene-graph isolation: this node is the purple card.
    expect(corridorGateVisibleDuring({ expeditionActive: true })).toBe(false);
  });
});
