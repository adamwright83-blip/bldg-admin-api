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

type GoogleAutocompleteSuggestion = {
  placePrediction?: {
    place?: string;
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    types?: string[];
  };
};

export type GooglePlaceAutocompleteSuggestion = {
  placeId: string;
  name: string;
  address: string;
  text: string;
  types: string[];
};

const STREET_SUFFIXES: Record<string, string> = {
  boulevard: "blvd",
  blvd: "blvd",
  street: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  place: "pl",
  pl: "pl",
  highway: "hwy",
  hwy: "hwy",
  parkway: "pkwy",
  pkwy: "pkwy",
  terrace: "ter",
  ter: "ter",
};

const normalizeLookupText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(token => STREET_SUFFIXES[token] ?? token)
    .join(" ");

function streetNumber(value: string): string | null {
  return value.trim().match(/^(\d{1,6})\b/)?.[1] ?? null;
}

function firstAddressLine(value: string): string {
  return value.split(",")[0]?.trim() ?? value.trim();
}

function looksLikeStreetAddress(value: string): boolean {
  return /^\s*\d{1,6}\s+\S+/.test(value.trim());
}

function looksLikeAddressLabel(name: string, formattedAddress: string): boolean {
  const normalizedName = normalizeLookupText(name);
  const normalizedAddress = normalizeLookupText(firstAddressLine(formattedAddress));
  if (!normalizedName || !normalizedAddress) return false;
  if (normalizedName === normalizedAddress) return true;

  const nameNumber = streetNumber(name);
  const addressNumber = streetNumber(firstAddressLine(formattedAddress));
  return Boolean(
    nameNumber &&
      addressNumber &&
      nameNumber === addressNumber &&
      normalizedName.includes(addressNumber)
  );
}

function isAddressOnlyPlace(place: GooglePlace): boolean {
  if (
    place.displayName?.text &&
    place.formattedAddress &&
    looksLikeAddressLabel(place.displayName.text, place.formattedAddress)
  ) {
    return true;
  }

  const types = place.types ?? [];
  const addressOnlyTypes = new Set([
    "street_address",
    "route",
    "intersection",
    "postal_code",
    "locality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "country",
  ]);
  return types.length > 0 && types.every(type => addressOnlyTypes.has(type));
}

function addressMatchesExactTarget(
  queryAddress: string,
  candidateAddress: string
): boolean {
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
  return (
    queryTokens.length > 0 &&
    queryTokens.every(token => candidateTokens.has(token))
  );
}

function nameMatchesExactTarget(query: string, candidateName: string): boolean {
  const queryName = normalizeLookupText(query.split(",")[0] ?? query);
  const candidate = normalizeLookupText(candidateName);
  if (!queryName || !candidate) return false;
  if (queryName === candidate) return true;

  const queryTokens = queryName.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (queryTokens.length < 2 || candidateTokens.length < 2) return false;

  return (
    queryTokens.every(token => candidateTokens.includes(token)) ||
    candidateTokens.every(token => queryTokens.includes(token))
  );
}

function placeIdFromPrediction(
  prediction: NonNullable<GoogleAutocompleteSuggestion["placePrediction"]>
): string | null {
  if (prediction.placeId) return prediction.placeId;
  if (prediction.place?.startsWith("places/")) {
    return prediction.place.slice("places/".length);
  }
  return null;
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

  async autocompleteBusinesses(
    query: string,
    limit = 6
  ): Promise<GooglePlaceAutocompleteSuggestion[]> {
    const response = await this.fetcher(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.placesApiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.types",
        },
        body: JSON.stringify({
          input: query,
          includedRegionCodes: ["us"],
          regionCode: "US",
          languageCode: "en",
          // This mission builder currently serves the Los Angeles operating area.
          // Autocomplete runs server-side, so without an explicit bias Google would
          // rank by the Railway server IP rather than the operator's service area.
          locationBias: {
            circle: {
              center: {
                latitude: 34.0522,
                longitude: -118.2437,
              },
              radius: 50_000,
            },
          },
        }),
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Google Places autocomplete failed with HTTP ${response.status}`
      );
    }

    const suggestions =
      ((await response.json()) as {
        suggestions?: GoogleAutocompleteSuggestion[];
      }).suggestions ?? [];

    return suggestions
      .flatMap(item => {
        const prediction = item.placePrediction;
        if (!prediction) return [];
        const placeId = placeIdFromPrediction(prediction);
        const text = prediction.text?.text?.trim() ?? "";
        const name =
          prediction.structuredFormat?.mainText?.text?.trim() ??
          text.split(",")[0]?.trim() ??
          "";
        const address =
          prediction.structuredFormat?.secondaryText?.text?.trim() ??
          text
            .split(",")
            .slice(1)
            .join(",")
            .trim();
        if (!placeId || !name) return [];
        return [
          {
            placeId,
            name,
            address,
            text: text || [name, address].filter(Boolean).join(", "),
            types: prediction.types ?? [],
          },
        ];
      })
      .slice(0, Math.max(1, Math.min(8, limit)));
  }

  private async placeDetails(placeId: string): Promise<GooglePlace | null> {
    const normalizedId = placeId.replace(/^places\//, "");
    const response = await this.fetcher(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(normalizedId)}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.placesApiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,location,types,websiteUri,nationalPhoneNumber,googleMapsUri",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Google Places details failed with HTTP ${response.status}`
      );
    }
    const place = (await response.json()) as GooglePlace;
    return place.id ? place : null;
  }

  private async searchTextPlaces(input: {
    textQuery: string;
    maxResultCount: number;
    center?: { lat: number; lng: number };
    radiusMeters?: number;
  }): Promise<GooglePlace[]> {
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
          textQuery: input.textQuery,
          maxResultCount: Math.max(1, Math.min(20, input.maxResultCount)),
          ...(input.center
            ? {
                locationBias: {
                  circle: {
                    center: {
                      latitude: input.center.lat,
                      longitude: input.center.lng,
                    },
                    radius: Math.max(25, Math.min(50_000, input.radiusMeters ?? 100)),
                  },
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Google Places exact lookup failed with HTTP ${response.status}`
      );
    }
    return ((await response.json()) as { places?: GooglePlace[] }).places ?? [];
  }

  private candidateFromPlace(
    place: GooglePlace,
    capturedAt: string
  ): TerritoryBusinessCandidate | null {
    if (
      !place.id ||
      !place.displayName?.text ||
      !place.formattedAddress ||
      place.location?.latitude == null ||
      place.location.longitude == null ||
      isAddressOnlyPlace(place)
    ) {
      return null;
    }
    return {
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
    };
  }

  async resolveBusinessByPlaceId(
    placeId: string
  ): Promise<TerritoryBusinessCandidate | null> {
    const capturedAt = new Date().toISOString();
    const place = await this.placeDetails(placeId);
    if (!place) return null;

    const direct = this.candidateFromPlace(place, capturedAt);
    if (direct) return direct;

    if (
      !place.formattedAddress ||
      place.location?.latitude == null ||
      place.location.longitude == null
    ) {
      return null;
    }

    const coLocated = await this.searchTextPlaces({
      textQuery: place.formattedAddress,
      maxResultCount: 10,
      center: {
        lat: place.location.latitude,
        lng: place.location.longitude,
      },
      radiusMeters: 120,
    });

    const namedProperty = coLocated.find(candidate => {
      if (
        !candidate.formattedAddress ||
        !candidate.displayName?.text ||
        isAddressOnlyPlace(candidate)
      ) {
        return false;
      }
      return addressMatchesExactTarget(
        place.formattedAddress!,
        candidate.formattedAddress
      );
    });

    return namedProperty
      ? this.candidateFromPlace(namedProperty, capturedAt)
      : null;
  }

  async resolveBusiness(query: string): Promise<TerritoryBusinessCandidate | null> {
    const capturedAt = new Date().toISOString();
    const streetAddress = looksLikeStreetAddress(query);
    const canonicalAddress = streetAddress
      ? await this.geocode(query)
          .then(result => result.formattedAddress)
          .catch(() => query)
      : query;

    const predictions = await this.autocompleteBusinesses(query, 6).catch(
      () => [] as GooglePlaceAutocompleteSuggestion[]
    );
    for (const prediction of predictions) {
      const candidate = await this.resolveBusinessByPlaceId(
        prediction.placeId
      ).catch(() => null);
      if (!candidate) continue;
      const matches = streetAddress
        ? addressMatchesExactTarget(canonicalAddress, candidate.formattedAddress)
        : nameMatchesExactTarget(query, candidate.name);
      if (matches) return candidate;
    }

    const places = await this.searchTextPlaces({
      textQuery: query,
      maxResultCount: 10,
    });
    const place = places.find(item => {
      if (
        !item.id ||
        !item.displayName?.text ||
        !item.formattedAddress ||
        item.location?.latitude == null ||
        item.location.longitude == null ||
        isAddressOnlyPlace(item)
      ) {
        return false;
      }
      return streetAddress
        ? addressMatchesExactTarget(canonicalAddress, item.formattedAddress)
        : nameMatchesExactTarget(query, item.displayName.text);
    });

    return place ? this.candidateFromPlace(place, capturedAt) : null;
  }

  async searchBusinesses(input: {
    center: GeoPoint;
    radiusMiles: number;
    categories: string[];
    limit: number;
  }): Promise<TerritoryBusinessCandidate[]> {
    const capturedAt = new Date().toISOString();
    const results = await Promise.all(
      input.categories.map(category =>
        this.searchTextPlaces({
          textQuery: category,
          maxResultCount: Math.min(20, input.limit),
          center: { lat: input.center.lat, lng: input.center.lng },
          radiusMeters: Math.min(50_000, input.radiusMiles * 1609.344),
        })
      )
    );

    return results.flat().flatMap(place => {
      const candidate = this.candidateFromPlace(place, capturedAt);
      return candidate ? [candidate] : [];
    });
  }
}
