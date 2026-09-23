import { fatalLogRecordFromError } from "@shared/clientFatal";

/** Best-effort. Never throws, and never logs the raw error object. */
export function reportClientFatal(error: unknown, correlationId: string): void {
  const record = fatalLogRecordFromError(error, correlationId);
  if (!record) return;
  console.error("[client-fatal]", record);
  if (typeof fetch !== "function") return;
  void fetch("/api/client-fatal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}
