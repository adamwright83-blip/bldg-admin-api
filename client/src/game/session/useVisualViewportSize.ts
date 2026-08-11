import { useEffect } from "react";

/**
 * Drives the game shell's size from real measured visual-viewport
 * dimensions instead of trusting the CSS `vw`/`dvh` units directly.
 *
 * Why this exists: `100vw`/`100dvh` are resolved against the browser's own
 * notion of the viewport, which on some real mobile browsers can diverge
 * from the actual visible screen area (the "layout viewport" the browser
 * uses for CSS unit resolution is not always identical to
 * `window.visualViewport`, particularly around meta-viewport edge cases and
 * dynamic browser-chrome resizing). Writing the real measured pixel values
 * onto CSS custom properties makes the shell's size a direct function of
 * what the browser reports as visible, which cannot silently diverge the
 * way a `vw` unit can.
 *
 * Sets `--goldline-vvw` / `--goldline-vvh` (in px) on the given element,
 * updated on load, window resize, visualViewport resize, and orientation
 * change. CSS still keeps a `100vw`/`100dvh` fallback for the instant
 * before this effect runs.
 */
export function useVisualViewportSize(target: HTMLElement | null): void {
  useEffect(() => {
    if (!target || typeof window === "undefined") return;

    const apply = () => {
      const vv = window.visualViewport;
      const width = vv?.width ?? window.innerWidth;
      const height = vv?.height ?? window.innerHeight;
      target.style.setProperty("--goldline-vvw", `${width}px`);
      target.style.setProperty("--goldline-vvh", `${height}px`);
    };

    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);

    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
    };
  }, [target]);
}
