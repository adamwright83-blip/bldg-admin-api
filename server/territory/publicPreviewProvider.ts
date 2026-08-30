import { TRPCError } from "@trpc/server";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";
import type { TerritoryBusinessProvider } from "./territoryDiscovery";
import { createDeterministicTerritoryProvider } from "./testSupport/deterministicTerritoryProvider";
import { ENV } from "../_core/env";

export function resolvePublicPreviewProvider(): TerritoryBusinessProvider {
  const releaseFixtureAllowed =
    process.env.DAYFORGE_RELEASE_TEST_MODE === "1" &&
    ["test", "ci"].includes(process.env.NODE_ENV ?? "");
  if (releaseFixtureAllowed) return createDeterministicTerritoryProvider();

  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
  if (!placesApiKey || !ENV.googleGeocodingApiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Territory provider is not configured",
    });
  }
  return new GooglePlacesTerritoryProvider({
    placesApiKey,
    geocodingApiKey: ENV.googleGeocodingApiKey,
  });
}
