/**
 * How corridor portals present themselves while an expedition is running.
 *
 * Outside an expedition, a comms portal draws its full card sprite — that
 * is long-standing corridor behaviour and must not change. During an
 * ACTIVE expedition the same card floats over the middle of the screen and
 * destroys the full-world composition, so the portal keeps existing (its
 * anchor, its distance maths, and every `onPortalProximity` callback are
 * untouched) but renders as a restrained in-world glow instead.
 *
 * This is presentation only. Nothing here changes whether a portal is
 * reachable, what it does, or when the runtime reports proximity — which
 * is precisely why it can be asserted as a pure rule rather than needing a
 * canvas.
 */

export type PortalPresentation = "card" | "ambient";

export function portalPresentationFor(input: {
  /** True only while the player is inside an active expedition. */
  expeditionActive: boolean;
  anchorType: string;
  /** True when the card texture actually loaded. */
  hasCardTexture: boolean;
}): PortalPresentation {
  if (input.expeditionActive) return "ambient";
  if (input.anchorType !== "comms_portal") return "ambient";
  return input.hasCardTexture ? "card" : "ambient";
}

/**
 * Ambient glow strength. During an expedition the glow is dialled well
 * down so it reads as light on stone rather than a marker hovering above
 * the painting.
 */
export function portalGlowAlpha(input: {
  expeditionActive: boolean;
  dominance: number;
}): { outer: number; inner: number } {
  if (input.expeditionActive) {
    return {
      outer: 0.02 + input.dominance * 0.05,
      inner: 0.03 + input.dominance * 0.06,
    };
  }
  return {
    outer: 0.05 + input.dominance * 0.1,
    inner: 0.08 + input.dominance * 0.14,
  };
}
