import { ENV } from "../_core/env";

export type GeocodeResult =
  | {
      status: "success";
      canonicalAddress: string;
      latitude: number;
      longitude: number;
      googlePlaceId: string | null;
      provider: "google_geocoding";
      extentKm?: number;
    }
  | { status: "unconfigured" }
  | { status: "ambiguous"; error: string }
  | { status: "transient_failure"; error: string }
  | { status: "provider_failure"; error: string };

type GoogleBody = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    partial_match?: boolean;
    geometry?: { location?: { lat?: number; lng?: number }; viewport?: { northeast: {lat:number;lng:number}; southwest:{lat:number;lng:number} } };
  }>;
};

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/key=[^&\s]+/gi, "key=[redacted]")
    .slice(0, 500);
}

export class GoogleGeocoder {
  constructor(
    private readonly apiKey = ENV.googleGeocodingApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async geocode(address: string): Promise<GeocodeResult> {
    if (!this.apiKey.trim()) return { status: "unconfigured" };
    let lastError = "Google geocoding request failed";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const url = new URL(
          "https://maps.googleapis.com/maps/api/geocode/json"
        );
        url.searchParams.set("address", address);
        url.searchParams.set("key", this.apiKey);
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          lastError = `Google geocoding HTTP ${response.status}`;
          if (response.status === 429 || response.status >= 500) continue;
          return { status: "provider_failure", error: lastError };
        }
        const body = (await response.json()) as GoogleBody;
        if (body.status === "ZERO_RESULTS")
          return { status: "ambiguous", error: "No geocoding result" };
        if (
          body.status === "OVER_QUERY_LIMIT" ||
          body.status === "UNKNOWN_ERROR"
        ) {
          lastError = `Google geocoding returned ${body.status}`;
          continue;
        }
        const result = body.results?.[0];
        const location = result?.geometry?.location;
        if (
          body.status !== "OK" ||
          !result?.formatted_address ||
          location?.lat == null ||
          location.lng == null
        ) {
          return {
            status: "provider_failure",
            error: safeError(
              body.error_message ??
                `Google geocoding returned ${body.status ?? "UNKNOWN"}`
            ),
          };
        }
        if (result.partial_match)
          return {
            status: "ambiguous",
            error: "Google returned a partial address match",
          };
        return {
          status: "success",
          canonicalAddress: result.formatted_address,
          latitude: location.lat,
          longitude: location.lng,
          googlePlaceId: result.place_id ?? null,
          provider: "google_geocoding",
          ...(result.geometry?.viewport ? { extentKm: Math.hypot((result.geometry.viewport.northeast.lat-result.geometry.viewport.southwest.lat)*111,(result.geometry.viewport.northeast.lng-result.geometry.viewport.southwest.lng)*111*Math.cos(location.lat*Math.PI/180)) } : {}),
        };
      } catch (error) {
        lastError = safeError(error);
      }
    }
    return { status: "transient_failure", error: lastError };
  }
}
