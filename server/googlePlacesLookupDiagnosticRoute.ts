import type express from "express";
import { GooglePlacesTerritoryProvider } from "./territory/googlePlacesTerritoryProvider";
import { isValidAgentSharedSecret } from "./agents/s2sEndpoint";

type ResolvingProvider = Pick<GooglePlacesTerritoryProvider, "resolveBusiness">;

const DEFAULT_ADDRESS = "4455 Los Feliz Blvd, Los Angeles, CA 90027";
const EXPECTED_STREET_NUMBER = "4455";
const EXPECTED_STREET_NAME = "los feliz blvd";

/**
 * Parses the leading street number and street name out of a formatted
 * address, e.g. "4455 Los Feliz Blvd, Los Angeles, CA 90027" ->
 * { streetNumber: "4455", streetName: "los feliz blvd" }.
 */
export function parseStreetNumberAndName(
  formattedAddress: string
): { streetNumber: string | null; streetName: string | null } {
  const firstSegment = formattedAddress.split(",")[0]?.trim() ?? "";
  const match = firstSegment.match(/^(\d+)\s+(.+)$/);
  if (!match) return { streetNumber: null, streetName: null };
  const [, streetNumber, streetName] = match;
  return {
    streetNumber: streetNumber.trim(),
    streetName: streetName.trim().toLowerCase(),
  };
}

export function isExactAddressMatch(formattedAddress: string): boolean {
  const { streetNumber, streetName } =
    parseStreetNumberAndName(formattedAddress);
  if (!streetNumber || !streetName) return false;
  return (
    streetNumber === EXPECTED_STREET_NUMBER &&
    streetName === EXPECTED_STREET_NAME
  );
}

function buildProvider(): ResolvingProvider {
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const geocodingApiKey = process.env.GOOGLE_GEOCODING_API_KEY ?? "";
  if (!placesApiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  }
  if (!geocodingApiKey) {
    throw new Error("GOOGLE_GEOCODING_API_KEY is not configured");
  }
  return new GooglePlacesTerritoryProvider({
    placesApiKey,
    geocodingApiKey,
  });
}

/**
 * TEMPORARY DIAGNOSTIC ENDPOINT: read-only verification of what Google
 * Places Text Search returns for a given address, using the exact same
 * GooglePlacesTerritoryProvider.resolveBusiness() logic the driver mission
 * builder relies on. Does not mutate any data. Safe to remove once the
 * Los Feliz Towers resolution question is answered.
 */
export function registerGooglePlacesLookupDiagnosticRoute(
  app: express.Express,
  deps?: { provider?: ResolvingProvider }
) {
  const handler = async (req: express.Request, res: express.Response) => {
    if (!isValidAgentSharedSecret(req.headers["x-agent-shared-secret"])) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "GOOGLE_PLACES_LOOKUP_UNAUTHORIZED",
      });
    }

    const address =
      typeof req.query.address === "string" && req.query.address.trim()
        ? req.query.address.trim()
        : DEFAULT_ADDRESS;

    try {
      const provider = deps?.provider ?? buildProvider();
      const resolved = await provider.resolveBusiness(address);
      if (!resolved) {
        return res.status(200).json({ resolved: null });
      }
      return res.status(200).json({
        name: resolved.name,
        formattedAddress: resolved.formattedAddress,
        providerId: resolved.providerId,
        types: resolved.categories,
        lat: resolved.lat,
        lng: resolved.lng,
        website: resolved.website ?? null,
        phone: resolved.phone ?? null,
        exactMatch: isExactAddressMatch(resolved.formattedAddress),
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        code: "GOOGLE_PLACES_LOOKUP_FAILED",
      });
    }
  };

  app.get("/admin/diagnostic/google-places-lookup", handler);
  app.post("/admin/diagnostic/google-places-lookup", handler);
}
