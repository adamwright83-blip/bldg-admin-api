export type GoogleCapabilityName =
  | "geocoding"
  | "address_validation"
  | "places"
  | "places_aggregate"
  | "maps_javascript"
  | "map_tiles"
  | "aerial_view"
  | "street_view_static"
  | "weather"
  | "air_quality";

export type GoogleCapabilityStatus =
  | "configured"
  | "available"
  | "unavailable"
  | "degraded"
  | "coverage_missing"
  | "permission_denied"
  | "quota_limited";

export type GoogleCapabilityState = {
  name: GoogleCapabilityName;
  status: GoogleCapabilityStatus;
  hasCredential: boolean;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  coverageNotes?: string;
  fallbackActive: boolean;
};

export type GoogleWorldCapabilities = {
  generatedAt: string;
  capabilities: Record<GoogleCapabilityName, GoogleCapabilityState>;
  overallStatus: "fully_operational" | "partially_degraded" | "fallback_only" | "unconfigured";
};

export type GoogleTelemetryEvent = {
  id: string;
  api: GoogleCapabilityName;
  requestType: string;
  elapsedMs: number;
  success: boolean;
  status: GoogleCapabilityStatus;
  coverageMiss?: boolean;
  fallbackSelected?: string;
  cacheHit?: boolean;
  timestamp: string;
  error?: string;
};
