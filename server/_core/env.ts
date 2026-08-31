const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const RETIRED_ANTHROPIC_MODEL_REPLACEMENTS: Record<string, string> = {
  "claude-sonnet-4-20250514": DEFAULT_ANTHROPIC_MODEL,
};

export function normalizeAnthropicModel(raw: string): string {
  return RETIRED_ANTHROPIC_MODEL_REPLACEMENTS[raw] ?? raw;
}

function anthropicModelEnv(name: string, fallback = ""): string {
  const raw = process.env[name]?.trim() || fallback;
  return normalizeAnthropicModel(raw);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  googleGeocodingApiKey: process.env.GOOGLE_GEOCODING_API_KEY?.trim() ?? "",
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "",
  googleMapsJavascriptApiKey: process.env.GOOGLE_MAPS_JAVASCRIPT_API_KEY?.trim() ?? "",
  googleMapTilesApiKey: process.env.GOOGLE_MAP_TILES_API_KEY?.trim() ?? "",
  googleAerialViewApiKey: process.env.GOOGLE_AERIAL_VIEW_API_KEY?.trim() ?? "",
  googleStreetViewStaticApiKey: process.env.GOOGLE_STREET_VIEW_STATIC_API_KEY?.trim() ?? "",
  googlePlacesAggregateApiKey: process.env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim() ?? "",
  googleWeatherApiKey: process.env.GOOGLE_WEATHER_API_KEY?.trim() ?? "",
  googleAddressValidationApiKey: process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim() ?? "",
  googleAirQualityApiKey: process.env.GOOGLE_AIR_QUALITY_API_KEY?.trim() ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Anthropic (catalog AI). Forge is unused for invokeLLM. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: anthropicModelEnv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
  anthropicModelVendorOnboarding: anthropicModelEnv(
    "ANTHROPIC_MODEL_VENDOR_ONBOARDING"
  ),
  /** Slice 77b: Mission Composer query-plan parser. Cheap/fast model preferred -- falls back to anthropicModel if unset. */
  anthropicModelMissionPlanner: anthropicModelEnv(
    "ANTHROPIC_MODEL_MISSION_PLANNER"
  ),
  /** Slice 81b: website service-area interpreter. Falls back to anthropicModel if unset. */
  anthropicModelServiceAreaVerifier: anthropicModelEnv(
    "ANTHROPIC_MODEL_SERVICE_AREA_VERIFIER"
  ),
  platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT ?? "5"),
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? "https://admin.bldg.chat",
  /**
   * When true, outbound reminder infrastructure exists; UI still shows "attempted" until log status is
   * `delivered` (webhook-confirmed only). Does not imply messages are sent.
   */
  revenueReminderOutboundConfigured:
    process.env.REVENUE_REMINDER_OUTBOUND_CONFIGURED === "true",
  /** Boss-demo operational layer: resettable, isolated demo tenant. Off by default. */
  dayforgeDemoEnabled: process.env.DAYFORGE_DEMO_ENABLED === "true",
  dayforgeDemoTenantSlug:
    process.env.DAYFORGE_DEMO_TENANT_SLUG?.trim() || "sunset-laundry-demo",
};
