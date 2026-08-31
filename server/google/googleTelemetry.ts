import type { GoogleCapabilityName, GoogleCapabilityStatus, GoogleTelemetryEvent } from "../../shared/googleCapabilities";

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

  telemetryLogs.unshift(item);
  if (telemetryLogs.length > MAX_LOGS) {
    telemetryLogs.pop();
  }

  return item;
}

export function getGoogleTelemetryLogs(): GoogleTelemetryEvent[] {
  return [...telemetryLogs];
}
