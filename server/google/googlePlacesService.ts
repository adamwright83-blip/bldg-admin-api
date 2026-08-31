import { ENV } from "../_core/env";
import { recordGoogleTelemetry } from "./googleTelemetry";

export type GooglePlacePhoto = {
  name: string; // e.g. "places/ChIJ.../photos/..."
  widthPx: number;
  heightPx: number;
  authorAttributions: Array<{
    displayName: string;
    uri?: string;
    photoUri?: string;
  }>;
};

export type GooglePlaceDetails = {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  websiteUri?: string;
  businessStatus?: string;
  photos?: GooglePlacePhoto[];
  primaryPhotoUri?: string;
  primaryPhotoAttribution?: {
    displayName: string;
    uri?: string;
  };
};

export class GooglePlacesService {
  constructor(
    private readonly apiKey = ENV.googlePlacesApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getPlaceDetails(placeId: string): Promise<{
    place: GooglePlaceDetails | null;
    status: "available" | "unavailable" | "unconfigured" | "error";
    error?: string;
  }> {
    if (!this.apiKey.trim()) {
      return { place: null, status: "unconfigured" };
    }

    const start = performance.now();
    try {
      const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
      const res = await this.fetcher(url, {
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,primaryType,types,websiteUri,businessStatus,photos",
        },
        signal: AbortSignal.timeout(8000),
      });

      const elapsedMs = performance.now() - start;

      if (!res.ok) {
        recordGoogleTelemetry({
          api: "places",
          requestType: "places:get",
          elapsedMs,
          success: false,
          status: res.status === 403 || res.status === 401 ? "permission_denied" : "unavailable",
          error: `Google Places HTTP ${res.status}`,
        });
        return { place: null, status: "unavailable", error: `Google Places HTTP ${res.status}` };
      }

      const json = await res.json() as any;
      const firstPhoto = json.photos?.[0];
      let primaryPhotoUri: string | undefined;
      let primaryPhotoAttribution: { displayName: string; uri?: string } | undefined;

      if (firstPhoto?.name) {
        primaryPhotoUri = `/api/google/places-photo?name=${encodeURIComponent(firstPhoto.name)}`;
        const author = firstPhoto.authorAttributions?.[0];
        if (author) {
          primaryPhotoAttribution = {
            displayName: author.displayName ?? "Google Maps Contributor",
            uri: author.uri,
          };
        }
      }

      const place: GooglePlaceDetails = {
        id: json.id ?? placeId,
        displayName: json.displayName?.text ?? json.displayName ?? "Verified Building",
        formattedAddress: json.formattedAddress ?? "",
        location: {
          latitude: json.location?.latitude ?? 0,
          longitude: json.location?.longitude ?? 0,
        },
        primaryType: json.primaryType,
        types: json.types,
        websiteUri: json.websiteUri,
        businessStatus: json.businessStatus,
        photos: json.photos,
        primaryPhotoUri,
        primaryPhotoAttribution,
      };

      recordGoogleTelemetry({
        api: "places",
        requestType: "places:get",
        elapsedMs,
        success: true,
        status: "available",
      });

      return { place, status: "available" };
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "places",
        requestType: "places:get",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });
      return { place: null, status: "error", error: String(err) };
    }
  }

  async findPlaceByText(query: string): Promise<GooglePlaceDetails | null> {
    if (!this.apiKey.trim()) return null;

    const start = performance.now();
    try {
      const url = new URL("https://places.googleapis.com/v1/places:searchText");
      const res = await this.fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.photos",
        },
        body: JSON.stringify({
          textQuery: query,
          locationBias: {
            circle: {
              center: { latitude: 34.0522, longitude: -118.2437 },
              radius: 25000.0,
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      const elapsedMs = performance.now() - start;

      if (!res.ok) {
        recordGoogleTelemetry({
          api: "places",
          requestType: "places:searchText",
          elapsedMs,
          success: false,
          status: "unavailable",
          error: `Places SearchText HTTP ${res.status}`,
        });
        return null;
      }

      const json = await res.json() as any;
      const first = json.places?.[0];
      if (!first) {
        recordGoogleTelemetry({
          api: "places",
          requestType: "places:searchText",
          elapsedMs,
          success: true,
          status: "coverage_missing",
          coverageMiss: true,
        });
        return null;
      }

      const firstPhoto = first.photos?.[0];
      let primaryPhotoUri: string | undefined;
      let primaryPhotoAttribution: { displayName: string; uri?: string } | undefined;

      if (firstPhoto?.name) {
        primaryPhotoUri = `/api/google/places-photo?name=${encodeURIComponent(firstPhoto.name)}`;
        const author = firstPhoto.authorAttributions?.[0];
        if (author) {
          primaryPhotoAttribution = {
            displayName: author.displayName ?? "Google Maps Contributor",
            uri: author.uri,
          };
        }
      }

      recordGoogleTelemetry({
        api: "places",
        requestType: "places:searchText",
        elapsedMs,
        success: true,
        status: "available",
      });

      return {
        id: first.id,
        displayName: first.displayName?.text ?? first.displayName ?? query,
        formattedAddress: first.formattedAddress ?? "",
        location: {
          latitude: first.location?.latitude ?? 0,
          longitude: first.location?.longitude ?? 0,
        },
        primaryType: first.primaryType,
        photos: first.photos,
        primaryPhotoUri,
        primaryPhotoAttribution,
      };
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "places",
        requestType: "places:searchText",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });
      return null;
    }
  }
}
