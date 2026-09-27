import type express from "express";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";
import { ENV } from "../_core/env";

const DEFAULT_QUERY = "4455 Los Feliz Blvd, Los Angeles, CA 90027";

function hasValidAdminSecret(req: express.Request): boolean {
  const expected = process.env.ADMIN_AGENT_SHARED_SECRET ?? "";
  if (!expected) return true;
  const provided =
    typeof req.query.adminSecret === "string" ? req.query.adminSecret : "";
  return !!provided && provided === expected;
}

function buildGooglePlacesTerritoryProvider(): GooglePlacesTerritoryProvider {
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
  if (!placesApiKey || !ENV.googleGeocodingApiKey) {
    throw new Error(
      !placesApiKey
        ? "GOOGLE_PLACES_API_KEY is not configured"
        : "GOOGLE_GEOCODING_API_KEY is not configured"
    );
  }
  return new GooglePlacesTerritoryProvider({
    placesApiKey,
    geocodingApiKey: ENV.googleGeocodingApiKey,
  });
}

function isExactAddressMatch(formattedAddress: string): boolean {
  const normalized = formattedAddress.trim().toLowerCase();
  return (
    normalized.startsWith("4455 los feliz blvd") ||
    normalized.startsWith("4455 los feliz boulevard")
  );
}

/**
 * Read-only diagnostic endpoint. Reuses the exact same
 * GooglePlacesTerritoryProvider.resolveBusiness() lookup used by the driver
 * mission builder so production acceptance testing can verify the precise
 * Google Places result for a query without creating any missions or
 * mutating any data.
 */
export function registerPlacesLookupDiagnosticRoute(app: express.Express): void {
  app.get("/api/admin/diagnostic/places-lookup", async (req, res) => {
    if (!hasValidAdminSecret(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "PLACES_LOOKUP_UNAUTHORIZED",
      });
    }

    const rawQuery = req.query.q;
    const query =
      (typeof rawQuery === "string" && rawQuery.trim()) || DEFAULT_QUERY;

    try {
      const provider = buildGooglePlacesTerritoryProvider();
      const candidate = await provider.resolveBusiness(query);
      if (!candidate) {
        return res.status(400).json({
          error: "No matching place found",
          code: "PLACES_LOOKUP_NO_RESULT",
          query,
        });
      }
      return res.status(200).json({
        name: candidate.name,
        formattedAddress: candidate.formattedAddress,
        providerId: candidate.providerId,
        categories: candidate.categories,
        lat: candidate.lat,
        lng: candidate.lng,
        exactAddressMatch: isExactAddressMatch(candidate.formattedAddress),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({
        error: "Places lookup failed",
        code: "PLACES_LOOKUP_FAILED",
        message,
      });
    }
  });
}
