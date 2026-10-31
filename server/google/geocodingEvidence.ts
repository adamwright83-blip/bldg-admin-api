import { classifyGoogleFailure, recordGoogleTelemetry } from "./googleTelemetry";

/**
 * Evidence for the Geocoding API capability without editing the geocoder: server/geography/** is owner-protected
 * (server/president/fabric/invariants.test.ts, invariant 28). This wraps the fetch handed to GoogleGeocoder and
 * records what the Geocoding API answered (status read from a clone; the caller gets the response untouched).
 * Calls to any other URL pass straight through, unrecorded.
 */
export function geocodingEvidenceFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("maps.googleapis.com/maps/api/geocode/")) return base(input, init);
    const started = performance.now();
    const record = (success: boolean, httpStatus: number | null, providerStatus: string | null, error?: string) =>
      recordGoogleTelemetry({
        api: "geocoding",
        requestType: "geocode:json",
        elapsedMs: performance.now() - started,
        success,
        status: success ? "available" : classifyGoogleFailure({ httpStatus, providerStatus }),
        error,
      });
    let response: Response;
    try {
      response = await base(input, init);
    } catch (error) {
      record(false, null, null, error instanceof Error ? error.message : "no answer");
      throw error;
    }
    let body: { status?: string; error_message?: string } | null = null;
    try {
      body = (await response.clone().json()) as { status?: string; error_message?: string };
    } catch {
      body = null;
    }
    const provider = body?.status ?? null;
    // ZERO_RESULTS is the API working: it looked and found nothing
    if (response.ok && (provider === "OK" || provider === "ZERO_RESULTS")) record(true, response.status, provider);
    else record(false, response.status, provider, body?.error_message ?? `Google geocoding ${provider ?? `HTTP ${response.status}`}`);
    return response;
  }) as typeof fetch;
}
