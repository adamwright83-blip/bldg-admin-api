import { useEffect } from "react";

/**
 * Drives Goldline from the browser's measured visual viewport and marks
 * touch/standalone environments so the real device owns the full viewport.
 * Width alone is deliberately not a mobile signal: a Pixel-class device in
 * landscape can be wider than the desktop phone-preview cap.
 */
export function useVisualViewportSize(target: HTMLElement | null): void {
  useEffect(() => {
    if (!target || typeof window === "undefined") return;

    const mobileViewport =
      navigator.maxTouchPoints > 0 ||
      "ontouchstart" in window ||
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches ||
      window.matchMedia("(display-mode: standalone)").matches;

    target.dataset.goldlineMobileViewport = mobileViewport ? "true" : "false";

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
      delete target.dataset.goldlineMobileViewport;
    };
  }, [target]);
}
