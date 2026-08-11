/** True once the app is actually running as an installed/standalone app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mediaStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  // iOS Safari has no `display-mode: standalone` media query support in all
  // versions; it exposes navigator.standalone instead.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mediaStandalone || iosStandalone);
}

/** iOS has no beforeinstallprompt API — this gates the manual "Add to Home Screen" guidance. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
