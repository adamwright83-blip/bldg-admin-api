import type {
  GeoPoint,
  TerritoryBusinessCandidate,
  TerritoryBusinessProvider,
} from "./territoryDiscovery";

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
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!apiKey.trim())
      throw new Error(
        "GOOGLE_MAPS_API_KEY is required for territory discovery"
      );
  }

  async geocode(addressOrBusiness: string): Promise<GeoPoint> {
    const response = await this.fetcher(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({
          textQuery: addressOrBusiness,
          maxResultCount: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Google Places address lookup failed with HTTP ${response.status}`
      );
    }
    const body = (await response.json()) as { places?: GooglePlace[] };
    const result = body.places?.[0];
    if (
      !result?.formattedAddress ||
      result.location?.latitude == null ||
      result.location.longitude == null
    ) {
      throw new Error("Google Places address lookup returned ZERO_RESULTS");
    }
    return {
      lat: result.location.latitude,
      lng: result.location.longitude,
      formattedAddress: result.formattedAddress,
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
              "X-Goog-Api-Key": this.apiKey,
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
