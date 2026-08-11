import { useEffect, useState } from "react";

/**
 * Truthful network status for the game shell.
 *
 * When the backend is unreachable, the game must never fabricate a business
 * completion — it may only report its own connectivity state in game-native
 * language ("SIGNAL LOST") and let queued mutations retry once reconnected.
 * This hook makes no network calls itself; it only reflects the browser's own
 * online/offline signal.
 */
export type NetworkStatus = "online" | "offline";

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() =>
    typeof navigator === "undefined" || navigator.onLine ? "online" : "offline"
  );

  useEffect(() => {
    const goOnline = () => setStatus("online");
    const goOffline = () => setStatus("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return status;
}

export function networkStatusLabel(status: NetworkStatus): string {
  return status === "offline" ? "SIGNAL LOST · RECONNECTING" : "";
}
