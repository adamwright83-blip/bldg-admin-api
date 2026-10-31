import type { GoogleCapabilityName, GoogleCapabilityStatus, GoogleTelemetryEvent } from "../../shared/googleCapabilities";
import { recordCapabilityEvidence } from "./googleCapabilityEvidence";

const MAX_LOGS = 100;
const telemetryLogs: GoogleTelemetryEvent[] = [];

let counter = 0;

export function recordGoogleTelemetry(event: {
  api: GoogleCapabilityName;
  requestType: string;
  elapsedMs: number;
  success: boolean;
  status: GoogleCapabilityStatus;
  coverageMiss?: boolean;
  fallbackSelected?: string;
  cacheHit?: boolean;
  error?: string;
}): GoogleTelemetryEvent {
  counter += 1;
  const sanitizedError = event.error
    ? event.error.replace(/key=[^&\s]+/gi, "key=[redacted]").slice(0, 300)
    : undefined;

  const item: GoogleTelemetryEvent = {
    id: `tel-${Date.now()}-${counter}`,
    api: event.api,
    requestType: event.requestType,
    elapsedMs: Math.round(event.elapsedMs),
    success: event.success,
    status: event.status,
    coverageMiss: event.coverageMiss,
    fallbackSelected: event.fallbackSelected,
    cacheHit: event.cacheHit,
    timestamp: new Date().toISOString(),
    error: sanitizedError,
  };

  // newest first: telemetryLogs[0] is the latest event
  telemetryLogs.unshift(item);
  if (telemetryLogs.length > MAX_LOGS) {
    telemetryLogs.pop();
  }

  // only Google's own answers are evidence: not a cache hit, and not a fallback provider's success
  if (isGoogleAnswer(item)) {
    void recordCapabilityEvidence({
      capability: event.api,
      status: event.status,
      success: event.success,
      at: new Date(item.timestamp),
      error: sanitizedError ?? null,
      latencyMs: item.elapsedMs,
    });
  }

  return item;
}

/**
 * Whether an event is Google's own answer. A cache hit isn't a call. A success that names `fallbackSelected` is the
 * fallback provider's answer (e.g. Open-Meteo after Google Weather refused), not Google's; the refusal before it,
 * recorded with success false, is Google's answer and stays the evidence.
 */
export function isGoogleAnswer(event: Pick<GoogleTelemetryEvent, "cacheHit" | "success" | "fallbackSelected">): boolean {
  return !event.cacheHit && !(event.success && event.fallbackSelected);
}

/** Google's newest answer for this API in this process (the log is newest first), or null. */
export function latestGoogleTelemetry(api: GoogleCapabilityName): GoogleTelemetryEvent | null {
  return telemetryLogs.find(event => event.api === api && isGoogleAnswer(event)) ?? null;
}

/**
 * One reading of a failed Google call, shared by every adapter: who refused it and why. `providerStatus` is the
 * status in the body (legacy Maps: REQUEST_DENIED / OVER_QUERY_LIMIT; Google APIs: PERMISSION_DENIED /
 * RESOURCE_EXHAUSTED); `httpStatus` null means no answer arrived.
 */
export function classifyGoogleFailure(input: { httpStatus: number | null; providerStatus?: string | null }): GoogleCapabilityStatus {
  const provider = (input.providerStatus ?? "").toUpperCase();
  if (provider === "REQUEST_DENIED" || provider === "PERMISSION_DENIED" || provider === "UNAUTHENTICATED") return "permission_denied";
  if (provider === "OVER_QUERY_LIMIT" || provider === "OVER_DAILY_LIMIT" || provider === "RESOURCE_EXHAUSTED") return "quota_limited";
  if (input.httpStatus === 401 || input.httpStatus === 403) return "permission_denied";
  if (input.httpStatus === 429) return "quota_limited";
  return "provider_error";
}

export function getGoogleTelemetryLogs(): GoogleTelemetryEvent[] {
  return [...telemetryLogs];
}
