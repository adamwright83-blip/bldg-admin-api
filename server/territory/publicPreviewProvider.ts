import { TRPCError } from "@trpc/server";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";
import type { TerritoryBusinessProvider } from "./territoryDiscovery";
import { createDeterministicTerritoryProvider } from "./testSupport/deterministicTerritoryProvider";

export function resolvePublicPreviewProvider(): TerritoryBusinessProvider {
  const releaseFixtureAllowed =
    process.env.DAYFORGE_RELEASE_TEST_MODE === "1" &&
    ["test", "ci"].includes(process.env.NODE_ENV ?? "");
  if (releaseFixtureAllowed) return createDeterministicTerritoryProvider();

  const key =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key.trim()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Territory provider is not configured",
    });
  }
  return new GooglePlacesTerritoryProvider(key);
}
