/**
 * Registers goldline-sw.js scoped to /driver only — it never intercepts
 * requests for the rest of this multi-product host (admin dashboard,
 * Dayforge, etc.). Safe to call multiple times; the browser no-ops a
 * re-registration of the same script+scope.
 */
export function registerGoldlineServiceWorker(): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (typeof window === "undefined") return;
  // Service workers require a secure context; localhost is exempted by
  // the browser itself, so no extra check is needed here.
  void navigator.serviceWorker
    .register("/goldline-sw.js", { scope: "/driver" })
    .catch(() => {
      // Best-effort only — the game must work identically without a
      // successfully registered service worker.
    });
}
