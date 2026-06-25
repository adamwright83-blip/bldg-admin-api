// Slice 76a (fixed). Read-only Google Places discovery connector.
//
// This module never sends outreach, never contacts a vendor, and never
// marks any provider-acceptance/booking/payment/dispatch truth. It only
// queries Google's Places API (New) Text Search (given an operator's own
// API key) and normalizes the results into candidate evidence. Missing
// fields (phone, website) are left absent -- never inferred or invented.
//
// Uses Places API (New), not the legacy Places API -- a key restricted to
// "Places API (New)" in Google Cloud is rejected (REQUEST_DENIED) by the
// legacy endpoint, since they are different API products.

export const GOOGLE_PLACES_API_KEY_ENV_VAR = "GOOGLE_PLACES_API_KEY";

const PLACES_API_NEW_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_API_NEW_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.rating",
  "places.userRatingCount", "places.location", "places.nationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri",
].join(",");

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
  website: string | null;
  phone: string | null;
  coordinates: { lat: number; lng: number } | null;
  sourceUrl: string;
};

export type GooglePlacesDiscoveryResult =
  | { status: "needs_provider_config"; missingEnvVar: typeof GOOGLE_PLACES_API_KEY_ENV_VAR }
  | { status: "provider_error"; reason: string; providerStatus?: string; providerMessage?: string; endpointFamily: "places_api_new" }
  | { status: "ok"; candidates: NormalizedPlaceCandidate[] };

type PlacesApiNewPlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  nationalPhoneNumber?: unknown;
  websiteUri?: unknown;
  googleMapsUri?: unknown;
};

type PlacesApiNewSearchTextResponse = {
  places?: PlacesApiNewPlace[];
  error?: { code?: unknown; message?: unknown; status?: unknown };
};

export type FetchResponseLike = { ok: boolean; status: number; json: () => Promise<unknown> };
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

function normalizePlace(raw: PlacesApiNewPlace): NormalizedPlaceCandidate | null {
  const placeId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  const businessName = typeof raw.displayName?.text === "string" && raw.displayName.text.trim()
    ? raw.displayName.text.trim() : null;
  if (!placeId || !businessName) return null;

  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;

  return {
    provider: "google_places",
    placeId,
    businessName,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    reviewCount: typeof raw.userRatingCount === "number" ? raw.userRatingCount : null,
    address: typeof raw.formattedAddress === "string" ? raw.formattedAddress : null,
    website: typeof raw.websiteUri === "string" ? raw.websiteUri : null,
    phone: typeof raw.nationalPhoneNumber === "string" ? raw.nationalPhoneNumber : null,
    coordinates: typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
    sourceUrl: typeof raw.googleMapsUri === "string" ? raw.googleMapsUri
      : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
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

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) {
    return { status: "provider_error", reason: "fetch_unavailable", endpointFamily: "places_api_new" };
  }

  let response: FetchResponseLike;
  try {
    response = await fetchImpl(PLACES_API_NEW_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_API_NEW_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query.searchText }),
    });
  } catch {
    return { status: "provider_error", reason: "request_failed", endpointFamily: "places_api_new" };
  }

  let body: PlacesApiNewSearchTextResponse;
  try {
    body = (await response.json()) as PlacesApiNewSearchTextResponse;
  } catch {
    return { status: "provider_error", reason: "invalid_response", endpointFamily: "places_api_new" };
  }

  if (!response.ok) {
    // Surface Google's own non-secret diagnostic fields (status/code/message)
    // rather than swallowing them down to a bare reason string. Google's
    // error payload never includes the API key, so this is safe to return.
    return {
      status: "provider_error",
      reason: typeof body.error?.status === "string" ? body.error.status : `http_${response.status}`,
      providerStatus: typeof body.error?.status === "string" ? body.error.status : undefined,
      providerMessage: typeof body.error?.message === "string" ? body.error.message : undefined,
      endpointFamily: "places_api_new",
    };
  }

  const normalized = (body.places ?? [])
    .map(normalizePlace)
    .filter((candidate): candidate is NormalizedPlaceCandidate => candidate !== null);

  const ratingFiltered = typeof query.minRating === "number"
    ? normalized.filter(candidate => candidate.rating !== null && candidate.rating >= query.minRating!)
    : normalized;

  return { status: "ok", candidates: ratingFiltered.slice(0, query.maxResults) };
}
