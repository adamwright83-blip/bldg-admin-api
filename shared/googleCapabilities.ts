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
  | "air_quality"
  /** campaign travel legs: the legacy Distance Matrix API (server/integrations/googleMaps/campaignTravelAdapter.ts) */
  | "distance_matrix";

/**
 * What JOYSTICK has actually seen from Google, never what its configuration implies. A key in Railway is only
 * "configured_not_yet_exercised" until a real call answers.
 */
export type GoogleCapabilityStatus =
  | "configured_not_yet_exercised"  // Key present but no real call has answered yet
  | "available"                     // A real call succeeded, recently (see lastSuccessAt)
  | "unconfigured"                  // No key present
  | "unavailable"                   // (older telemetry) the call failed; read as provider_error
  | "provider_error"                // Google answered with a server error, or didn't answer
  | "degraded"                      // partly worked, or a fallback served the request
  | "coverage_missing"
  | "permission_denied"             // 401/403, REQUEST_DENIED, API not enabled for the key, or key restrictions
  | "quota_limited"                 // 429, OVER_QUERY_LIMIT, RESOURCE_EXHAUSTED
  | "stale";                        // the newest evidence is too old to vouch for now (see lastCheckedAt)

export type GoogleCapabilityState = {
  name: GoogleCapabilityName;
  status: GoogleCapabilityStatus;
  hasCredential: boolean;
  /** when the newest real call answered (or failed); null when none has */
  lastCheckedAt: string | null;
  /** the newest successful call, kept across restarts; null when none was ever seen */
  lastSuccessAt: string | null;
  /** the newest failed call, kept across restarts */
  lastFailureAt: string | null;
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
