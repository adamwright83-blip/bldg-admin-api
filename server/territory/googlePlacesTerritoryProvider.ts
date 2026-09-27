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

const normalizeLookupText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function streetNumber(value: string): string | null {
  return value.trim().match(/^(\d{1,6})\b/)?.[1] ?? null;
}

function firstAddressLine(value: string): string {
  return value.split(",")[0]?.trim() ?? value.trim();
}

function looksLikeStreetAddress(value: string): boolean {
  return /^\s*\d{1,6}\s+\S+/.test(value.trim());
}

function isGeographicOnlyPlace(place: GooglePlace): boolean {
  const types = place.types ?? [];
  const geographicOnly = new Set([
    "street_address",
    "route",
    "intersection",
    "postal_code",
    "locality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "country",
    "premise",
    "subpremise",
  ]);
  return types.length > 0 && types.every(type => geographicOnly.has(type));
}

function addressMatchesExactTarget(queryAddress: string, candidateAddress: string): boolean {
  const queryLine = normalizeLookupText(firstAddressLine(queryAddress));
  const candidateLine = normalizeLookupText(firstAddressLine(candidateAddress));
  if (!queryLine || !candidateLine) return false;
  if (queryLine === candidateLine) return true;

  const queryNumber = streetNumber(firstAddressLine(queryAddress));
  const candidateNumber = streetNumber(firstAddressLine(candidateAddress));
  if (!queryNumber || queryNumber !== candidateNumber) return false;

  const queryTokens = queryLine.split(" ").filter(token => token !== queryNumber);
  const candidateTokens = new Set(
    candidateLine.split(" ").filter(token => token !== candidateNumber)
  );
  return queryTokens.length > 0 && queryTokens.every(token => candidateTokens.has(token));
}

function nameMatchesExactTarget(query: string, candidateName: string): boolean {
  const queryName = normalizeLookupText(query.split(",")[0] ?? query);
  const candidate = normalizeLookupText(candidateName);
  if (!queryName || !candidate) return false;
  if (queryName === candidate) return true;

  const queryTokens = queryName.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (candidateTokens.length < 2) return false;
  return candidateTokens.every(token => queryTokens.includes(token));
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
    const capturedAt = new Date().toISOString();
    const streetAddress = looksLikeStreetAddress(query);
    const canonicalAddress = streetAddress
      ? await this.geocode(query).then(result => result.formattedAddress).catch(() => query)
      : query;
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
          textQuery: query,
          maxResultCount: 5,
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
    const place = places.find(item => {
      if (
        !item.id ||
        !item.displayName?.text ||
        !item.formattedAddress ||
        item.location?.latitude == null ||
        item.location.longitude == null ||
        isGeographicOnlyPlace(item)
      ) {
        return false;
      }
      return streetAddress
        ? addressMatchesExactTarget(canonicalAddress, item.formattedAddress)
        : nameMatchesExactTarget(query, item.displayName.text);
    });
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
