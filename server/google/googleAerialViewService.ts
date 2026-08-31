import { ENV } from "../_core/env";
import { recordGoogleTelemetry } from "./googleTelemetry";

export type AerialViewResult = {
  buildingId: string;
  address: string;
  status: "active" | "processing" | "coverage_missing" | "unconfigured" | "error";
  videoId?: string;
  videoUri?: string;
  error?: string;
};

export class GoogleAerialViewService {
  constructor(
    private readonly apiKey = ENV.googleAerialViewApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async lookupAerialVideo(input: {
    buildingId: string;
    address: string;
  }): Promise<AerialViewResult> {
    if (!this.apiKey.trim()) {
      return {
        buildingId: input.buildingId,
        address: input.address,
        status: "unconfigured",
      };
    }

    const start = performance.now();
    try {
      const url = new URL("https://aerialview.googleapis.com/v1/videos:lookupVideo");
      url.searchParams.set("address", input.address);
      url.searchParams.set("key", this.apiKey);

      const res = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
      const elapsedMs = performance.now() - start;

      if (!res.ok) {
        const errorText = `Aerial View HTTP ${res.status}`;
        recordGoogleTelemetry({
          api: "aerial_view",
          requestType: "videos:lookupVideo",
          elapsedMs,
          success: false,
          status: res.status === 404 ? "coverage_missing" : "degraded",
          coverageMiss: res.status === 404,
          error: errorText,
        });

        return {
          buildingId: input.buildingId,
          address: input.address,
          status: res.status === 404 ? "coverage_missing" : "error",
          error: errorText,
        };
      }

      const json = await res.json() as any;
      const state = json.state; // "ACTIVE" | "PROCESSING"
      const videoUri = json.uris?.MP4_HIGH?.landscapeUri ?? json.uris?.MP4_MEDIUM?.landscapeUri ?? json.uris?.MP4_LOW?.landscapeUri;

      recordGoogleTelemetry({
        api: "aerial_view",
        requestType: "videos:lookupVideo",
        elapsedMs,
        success: true,
        status: state === "ACTIVE" ? "available" : "coverage_missing",
      });

      return {
        buildingId: input.buildingId,
        address: input.address,
        status: state === "ACTIVE" ? "active" : state === "PROCESSING" ? "processing" : "coverage_missing",
        videoId: json.id,
        videoUri,
      };
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "aerial_view",
        requestType: "videos:lookupVideo",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });

      return {
        buildingId: input.buildingId,
        address: input.address,
        status: "error",
        error: String(err),
      };
    }
  }
}
