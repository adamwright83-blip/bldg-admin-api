import { ENV } from "../_core/env";
import { recordGoogleTelemetry } from "./googleTelemetry";

export type StreetViewFacadeResult = {
  buildingId: string;
  hasCoverage: boolean;
  panoId?: string;
  location?: { latitude: number; longitude: number };
  imageUrl?: string;
  attributionText: string;
  status: "available" | "zero_results" | "unconfigured" | "error";
  contextLabel: "Verified facade" | "Building entrance" | "Place context" | "Physical arrival proof";
};

export class GoogleStreetViewService {
  constructor(
    private readonly apiKey = ENV.googleStreetViewStaticApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getBuildingFacade(input: {
    buildingId: string;
    latitude: number;
    longitude: number;
    hasGpsProof?: boolean;
    heading?: number;
    pitch?: number;
    fov?: number;
  }): Promise<StreetViewFacadeResult> {
    const contextLabel: StreetViewFacadeResult["contextLabel"] = input.hasGpsProof
      ? "Physical arrival proof"
      : "Verified facade";

    if (!this.apiKey.trim()) {
      return {
        buildingId: input.buildingId,
        hasCoverage: false,
        attributionText: "Google Street View",
        status: "unconfigured",
        contextLabel,
      };
    }

    const start = performance.now();
    try {
      // 1. Metadata check first to verify pano existence without downloading image
      const metaUrl = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
      metaUrl.searchParams.set("location", `${input.latitude},${input.longitude}`);
      metaUrl.searchParams.set("key", this.apiKey);

      const res = await this.fetcher(metaUrl, { signal: AbortSignal.timeout(6000) });
      const elapsedMs = performance.now() - start;

      if (!res.ok) {
        recordGoogleTelemetry({
          api: "street_view_static",
          requestType: "streetview/metadata",
          elapsedMs,
          success: false,
          status: "unavailable",
          error: `Street View Metadata HTTP ${res.status}`,
        });

        return {
          buildingId: input.buildingId,
          hasCoverage: false,
          attributionText: "© Google",
          status: "error",
          contextLabel,
        };
      }

      const json = await res.json() as any;
      if (json.status !== "OK") {
        recordGoogleTelemetry({
          api: "street_view_static",
          requestType: "streetview/metadata",
          elapsedMs,
          success: true,
          status: "coverage_missing",
          coverageMiss: true,
        });

        return {
          buildingId: input.buildingId,
          hasCoverage: false,
          attributionText: "© Google",
          status: "zero_results",
          contextLabel,
        };
      }

      // 2. Generate Street View Image URL for runtime display
      const imageUrl = new URL("https://maps.googleapis.com/maps/api/streetview");
      imageUrl.searchParams.set("size", "640x400");
      imageUrl.searchParams.set("location", `${input.latitude},${input.longitude}`);
      if (input.heading != null) imageUrl.searchParams.set("heading", String(input.heading));
      if (input.pitch != null) imageUrl.searchParams.set("pitch", String(input.pitch));
      if (input.fov != null) imageUrl.searchParams.set("fov", String(input.fov));
      imageUrl.searchParams.set("key", this.apiKey);

      recordGoogleTelemetry({
        api: "street_view_static",
        requestType: "streetview/metadata",
        elapsedMs,
        success: true,
        status: "available",
      });

      return {
        buildingId: input.buildingId,
        hasCoverage: true,
        panoId: json.pano_id,
        location: json.location ? { latitude: json.location.lat, longitude: json.location.lng } : undefined,
        imageUrl: imageUrl.toString(),
        attributionText: json.copyright ?? "© Google Street View",
        status: "available",
        contextLabel,
      };
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "street_view_static",
        requestType: "streetview/metadata",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });

      return {
        buildingId: input.buildingId,
        hasCoverage: false,
        attributionText: "© Google",
        status: "error",
        contextLabel,
      };
    }
  }
}
