// Slice 76a. Read-only Google Places discovery connector.
//
// This module never sends outreach, never contacts a vendor, and never
// marks any provider-acceptance/booking/payment/dispatch truth. It only
// queries Google's public Places Text Search API (given an operator's own
// API key) and normalizes the results into candidate evidence. Missing
// fields (phone, website) are left absent -- never inferred or invented.

export const GOOGLE_PLACES_API_KEY_ENV_VAR = "GOOGLE_PLACES_API_KEY";

export type GooglePlacesDiscoveryQuery = {
  searchText: string;
  minRating?: number | null;
  maxResults: number;
};

export type NormalizedPlaceCandidate = {
  provider: "google_places";
  placeId: string;
  businessName: string;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  website: null;
  phone: null;
  coordinates: { lat: number; lng: number } | null;
  sourceUrl: string;
};

export type GooglePlacesDiscoveryResult =
  | { status: "needs_provider_config"; missingEnvVar: typeof GOOGLE_PLACES_API_KEY_ENV_VAR }
  | { status: "provider_error"; reason: string }
  | { status: "ok"; candidates: NormalizedPlaceCandidate[] };

type GooglePlaceResult = {
  place_id?: unknown;
  name?: unknown;
  rating?: unknown;
  user_ratings_total?: unknown;
  formatted_address?: unknown;
  geometry?: { location?: { lat?: unknown; lng?: unknown } };
};

type GooglePlacesTextSearchResponse = {
  status?: unknown;
  error_message?: unknown;
  results?: GooglePlaceResult[];
};

export type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function toGoogleMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function normalizePlace(raw: GooglePlaceResult): NormalizedPlaceCandidate | null {
  const placeId = typeof raw.place_id === "string" && raw.place_id.trim() ? raw.place_id.trim() : null;
  const businessName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  if (!placeId || !businessName) return null;

  const lat = raw.geometry?.location?.lat;
  const lng = raw.geometry?.location?.lng;

  return {
    provider: "google_places",
    placeId,
    businessName,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    reviewCount: typeof raw.user_ratings_total === "number" ? raw.user_ratings_total : null,
    address: typeof raw.formatted_address === "string" ? raw.formatted_address : null,
    website: null,
    phone: null,
    coordinates: typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
    sourceUrl: toGoogleMapsUrl(placeId),
  };
}

export async function runGooglePlacesDiscovery(
  query: GooglePlacesDiscoveryQuery,
  options: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike } = {},
): Promise<GooglePlacesDiscoveryResult> {
  const env = options.env ?? process.env;
  const apiKey = env[GOOGLE_PLACES_API_KEY_ENV_VAR];
  if (!apiKey || !apiKey.trim()) {
    return { status: "needs_provider_config", missingEnvVar: GOOGLE_PLACES_API_KEY_ENV_VAR };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    return { status: "provider_error", reason: "fetch_unavailable" };
  }

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query.searchText)}&key=${encodeURIComponent(apiKey)}`;

  let response: { ok: boolean; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(url);
  } catch {
    return { status: "provider_error", reason: "request_failed" };
  }
  if (!response.ok) {
    return { status: "provider_error", reason: "request_failed" };
  }

  let body: GooglePlacesTextSearchResponse;
  try {
    body = (await response.json()) as GooglePlacesTextSearchResponse;
  } catch {
    return { status: "provider_error", reason: "invalid_response" };
  }

  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    return { status: "provider_error", reason: typeof body.status === "string" ? body.status : "unknown_provider_status" };
  }

  const normalized = (body.results ?? [])
    .map(normalizePlace)
    .filter((candidate): candidate is NormalizedPlaceCandidate => candidate !== null);

  const ratingFiltered = typeof query.minRating === "number"
    ? normalized.filter(candidate => candidate.rating !== null && candidate.rating >= query.minRating!)
    : normalized;

  return { status: "ok", candidates: ratingFiltered.slice(0, query.maxResults) };
}
