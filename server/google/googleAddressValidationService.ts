import { ENV } from "../_core/env";
import { recordGoogleTelemetry } from "./googleTelemetry";

export type AddressValidationResult =
  | {
      status: "success";
      formattedAddress: string;
      postalAddress: {
        addressLines: string[];
        locality: string;
        administrativeArea: string;
        postalCode: string;
      };
      latitude?: number;
      longitude?: number;
      placeId?: string;
      isComplete: boolean;
      granularity: string;
      hasInferredComponents: boolean;
      provider: "google_address_validation";
    }
  | { status: "unconfigured" }
  | { status: "ambiguous"; error: string }
  | { status: "provider_failure"; error: string };

export class GoogleAddressValidationService {
  constructor(
    private readonly apiKey = ENV.googleAddressValidationApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async validateAddress(address: string): Promise<AddressValidationResult> {
    if (!this.apiKey.trim()) {
      return { status: "unconfigured" };
    }

    const start = performance.now();
    try {
      const url = new URL("https://addressvalidation.googleapis.com/v1:validateAddress");
      url.searchParams.set("key", this.apiKey);

      const res = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: {
            regionCode: "US",
            addressLines: [address],
          },
        }),
        signal: AbortSignal.timeout(10000),
      });

      const elapsedMs = performance.now() - start;

      if (!res.ok) {
        recordGoogleTelemetry({
          api: "address_validation",
          requestType: "validateAddress",
          elapsedMs,
          success: false,
          status: res.status === 403 || res.status === 401 ? "permission_denied" : "degraded",
          error: `Google Address Validation HTTP ${res.status}`,
        });
        return { status: "provider_failure", error: `Google Address Validation HTTP ${res.status}` };
      }

      const json = await res.json() as any;
      const result = json.result;
      const verdict = result?.verdict;
      const postal = result?.address?.postalAddress;
      const formattedAddress = result?.address?.formattedAddress ?? address;
      const location = result?.geocode?.location;
      const placeId = result?.geocode?.plusCode?.globalCode ?? result?.geocode?.placeId;

      recordGoogleTelemetry({
        api: "address_validation",
        requestType: "validateAddress",
        elapsedMs,
        success: true,
        status: "available",
      });

      return {
        status: "success",
        formattedAddress,
        postalAddress: {
          addressLines: postal?.addressLines ?? [formattedAddress],
          locality: postal?.locality ?? "Los Angeles",
          administrativeArea: postal?.administrativeArea ?? "CA",
          postalCode: postal?.postalCode ?? "",
        },
        latitude: location?.latitude,
        longitude: location?.longitude,
        placeId,
        isComplete: verdict?.addressComplete === true,
        granularity: verdict?.validationGranularity ?? "PREMISE",
        hasInferredComponents: verdict?.hasInferredComponents === true,
        provider: "google_address_validation",
      };
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "address_validation",
        requestType: "validateAddress",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });
      return { status: "provider_failure", error: String(err) };
    }
  }
}
