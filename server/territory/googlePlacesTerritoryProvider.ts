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

function normalizedStreetSignature(value: string): string | null {
  const street = value
    .split(",")[0]!
    .toLowerCase()
    .replace(/(?:\s+#\s*\w+|\s+\b(?:apt|apartment|unit|suite|ste)\b\s*#?\s*\w+).*$/i, "")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(terrace)\b/g, "ter")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^\d{1,6}\s+\S+/.test(street) ? street : null;
}

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

  async resolveBusiness(query: string): Promise<TerritoryBusinessCandidate | null> {
    const textQuery = query.trim();
    if (!textQuery) return null;

    // An address is a target, not a search center. Anchor the request with
    // geocoding, then accept only a Places result at that same street address.
    const geocoded = await this.geocode(textQuery);
    const expectedStreet = normalizedStreetSignature(geocoded.formattedAddress);
    if (!expectedStreet) return null;

    const capturedAt = new Date().toISOString();
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
          textQuery,
          maxResultCount: 10,
          locationBias: {
            circle: {
              center: {
                latitude: geocoded.lat,
                longitude: geocoded.lng,
              },
              radius: 500,
            },
          },
        }),
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!response.ok)
      throw new Error(
        `Google Places exact lookup failed with HTTP ${response.status}`
      );
    const places =
      ((await response.json()) as { places?: GooglePlace[] }).places ?? [];
    const place = places.find(
      item =>
        item.id &&
        item.displayName?.text &&
        item.formattedAddress &&
        normalizedStreetSignature(item.formattedAddress) === expectedStreet &&
        item.location?.latitude != null &&
        item.location.longitude != null
    );
    if (!place?.id || !place.displayName?.text || !place.formattedAddress)
      return null;
    return {
      providerId: place.id,
      providerName: this.name,
      providerUrl: place.googleMapsUri ?? null,
      sourceCapturedAt: capturedAt,
      name: place.displayName.text,
      formattedAddress: place.formattedAddress,
      lat: place.location!.latitude!,
      lng: place.location!.longitude!,
      categories: place.types ?? [],
      website: place.websiteUri ?? null,
      phone: place.nationalPhoneNumber ?? null,
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
