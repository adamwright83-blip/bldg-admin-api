import { ENV } from "../_core/env";

export type GeocodeResult =
  | {
      status: "success";
      canonicalAddress: string;
      latitude: number;
      longitude: number;
      googlePlaceId: string | null;
      provider: "google_geocoding" | "google_places_text_search";
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
    private readonly fetcher: typeof fetch = fetch,
    private readonly placesApiKey = ENV.googlePlacesApiKey
  ) {}

  /**
   * Resolve an address to canonical Google coordinates.
   *
   * The Geocoding API is preferred. When its key is absent, or the key exists
   * but is restricted to other APIs, Places Text Search is used instead: it is
   * the same canonical Google place data, and deployments here commonly hold a
   * Places key whose Geocoding API was never enabled. The provider is reported
   * honestly either way so downstream provenance is never overstated.
   */
  async geocode(address: string): Promise<GeocodeResult> {
    if (!this.apiKey.trim()) return this.geocodeViaPlaces(address);
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
          return this.placesApiKey.trim()
            ? this.geocodeViaPlaces(address)
            : { status: "provider_failure", error: lastError };
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
        // A key restricted to other Google APIs is a configuration fact, not a
        // dead end: fall back rather than failing the caller.
        if (body.status === "REQUEST_DENIED" && this.placesApiKey.trim())
          return this.geocodeViaPlaces(address);
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

  /**
   * Area types Places uses for geographic regions. A service area must resolve
   * to one of these: an establishment that merely sits inside the area is a
   * wrong answer, not anear approximation, and it collapses the compiled world to
   * a single tiny territory around a storefront.
   */
  private static readonly AREA_TYPES = new Set([
    "locality", "sublocality", "neighborhood", "postal_code", "postal_town",
    "administrative_area_level_1", "administrative_area_level_2",
    "administrative_area_level_3", "political", "country",
  ]);

  /** Canonical Google place data via Places Text Search. */
  private async geocodeViaPlaces(address: string): Promise<GeocodeResult> {
    if (!this.placesApiKey.trim()) return { status: "unconfigured" };
    let lastError = "Google Places text search failed";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": this.placesApiKey,
              "X-Goog-FieldMask":
                "places.id,places.formattedAddress,places.location,places.viewport,places.types",
            },
            body: JSON.stringify({ textQuery: address, maxResultCount: 5 }),
            signal: AbortSignal.timeout(10_000),
          }
        );
        if (!response.ok) {
          lastError = `Google Places HTTP ${response.status}`;
          if (response.status === 429 || response.status >= 500) continue;
          return { status: "provider_failure", error: lastError };
        }
        const body = (await response.json()) as {
          places?: Array<{
            id?: string;
            formattedAddress?: string;
            types?: string[];
            location?: { latitude?: number; longitude?: number };
            viewport?: {
              low: { latitude: number; longitude: number };
              high: { latitude: number; longitude: number };
            };
          }>;
        };
        const place = body.places?.find(candidate =>
          candidate.types?.some(type => GoogleGeocoder.AREA_TYPES.has(type))
        );
        const location = place?.location;
        if (!place?.formattedAddress || location?.latitude == null || location.longitude == null)
          return {
            status: "ambiguous",
            error: body.places?.length
              ? "Matched a business rather than a service area"
              : "No Places result",
          };
        return {
          status: "success",
          canonicalAddress: place.formattedAddress,
          latitude: location.latitude,
          longitude: location.longitude,
          googlePlaceId: place.id ?? null,
          provider: "google_places_text_search",
          ...(place.viewport
            ? {
                extentKm: Math.hypot(
                  (place.viewport.high.latitude - place.viewport.low.latitude) * 111,
                  (place.viewport.high.longitude - place.viewport.low.longitude) *
                    111 *
                    Math.cos(location.latitude * (Math.PI / 180))
                ),
              }
            : {}),
        };
      } catch (error) {
        lastError = safeError(error);
      }
    }
    return { status: "transient_failure", error: lastError };
  }
}
