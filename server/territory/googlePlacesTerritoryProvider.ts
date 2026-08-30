import type {
  GeoPoint,
  TerritoryBusinessCandidate,
  TerritoryBusinessProvider,
} from "./territoryDiscovery";

type GoogleGeocodeResponse = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};
type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
};

export class GooglePlacesTerritoryProvider
  implements TerritoryBusinessProvider
{
  readonly name = "google_places";
  private readonly placesApiKey: string;
  private readonly geocodingApiKey: string;
  constructor(
    keys: string | { placesApiKey: string; geocodingApiKey: string },
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.placesApiKey = typeof keys === "string" ? keys : keys.placesApiKey;
    this.geocodingApiKey =
      typeof keys === "string" ? keys : keys.geocodingApiKey;
    if (!this.placesApiKey.trim())
      throw new Error("GOOGLE_PLACES_API_KEY is required for Places Search");
    if (!this.geocodingApiKey.trim())
      throw new Error("GOOGLE_GEOCODING_API_KEY is required for geocoding");
  }

  async geocode(addressOrBusiness: string): Promise<GeoPoint> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", addressOrBusiness);
    url.searchParams.set("key", this.geocodingApiKey);
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Google geocoding failed with HTTP ${response.status}`);
    const body = (await response.json()) as GoogleGeocodeResponse;
    const result = body.results?.[0];
    if (body.status !== "OK" || !result)
      throw new Error(
        body.error_message || `Google geocoding returned ${body.status}`
      );
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    };
  }

  async searchBusinesses(input: {
    center: GeoPoint;
    radiusMiles: number;
    categories: string[];
    limit: number;
  }): Promise<TerritoryBusinessCandidate[]> {
    const capturedAt = new Date().toISOString();
    const results = await Promise.all(
      input.categories.map(async category => {
        const response = await this.fetcher(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": this.placesApiKey,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri",
            },
            body: JSON.stringify({
              textQuery: category,
              maxResultCount: Math.min(20, input.limit),
              locationBias: {
                circle: {
                  center: {
                    latitude: input.center.lat,
                    longitude: input.center.lng,
                  },
                  radius: Math.min(50_000, input.radiusMiles * 1609.344),
                },
              },
            }),
            signal: AbortSignal.timeout(12_000),
          }
        );
        if (!response.ok)
          throw new Error(
            `Google Places search failed with HTTP ${response.status}`
          );
        return (
          ((await response.json()) as { places?: GooglePlace[] }).places ?? []
        );
      })
    );
    return results.flat().flatMap(place => {
      if (
        !place.id ||
        !place.displayName?.text ||
        !place.formattedAddress ||
        place.location?.latitude == null ||
        place.location.longitude == null
      )
        return [];
      return [
        {
          providerId: place.id,
          providerName: this.name,
          providerUrl: place.googleMapsUri ?? null,
          sourceCapturedAt: capturedAt,
          name: place.displayName.text,
          formattedAddress: place.formattedAddress,
          lat: place.location.latitude,
          lng: place.location.longitude,
          categories: place.types ?? [],
          website: place.websiteUri ?? null,
          phone: place.nationalPhoneNumber ?? null,
        },
      ];
    });
  }
}
