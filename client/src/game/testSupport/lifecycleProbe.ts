export type GoldlineLifecycleProbeKind = "pixiTicker";

declare global {
  interface Window {
    __GOLDLINE_LIFECYCLE_PROBE__?: {
      update: (kind: GoldlineLifecycleProbeKind, delta: 1 | -1) => void;
    };
  }
}

/**
 * Optional browser-test seam. Production never installs the probe, so this is
 * a no-op outside the permanent Goldline Playwright gate.
 */
export function reportGoldlineLifecycleDelta(
  kind: GoldlineLifecycleProbeKind,
  delta: 1 | -1
): void {
  if (typeof window === "undefined") return;
  window.__GOLDLINE_LIFECYCLE_PROBE__?.update(kind, delta);
}
