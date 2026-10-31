import { ENV } from "../_core/env";
import { GoogleGeocoder } from "../geography/googleGeocoder";
import { GoogleAddressValidationService, type AddressValidationResult } from "./googleAddressValidationService";
import { GoogleWeatherService } from "./googleWeatherService";
import { GoogleAirQualityService } from "./googleAirQualityService";
import { GooglePlacesService, type GooglePlaceDetails } from "./googlePlacesService";
import { GooglePlacesAggregateService, type DistrictPresence } from "./googlePlacesAggregateService";
import { loadDistrictPresence } from "./districtPresence";
import { geocodingEvidenceFetch } from "./geocodingEvidence";
import { GoogleAerialViewService, type AerialViewResult } from "./googleAerialViewService";
import { GoogleStreetViewService, type StreetViewFacadeResult } from "./googleStreetViewService";
import {
  projectWorldAtmosphere,
  type WorldAtmosphereProjection,
} from "../../shared/worldAtmosphere";
import type {
  GoogleCapabilityName,
  GoogleCapabilityState,
  GoogleTelemetryEvent,
  GoogleWorldCapabilities,
} from "../../shared/googleCapabilities";
import { getGoogleTelemetryLogs, latestGoogleTelemetry } from "./googleTelemetry";
import { loadCapabilityEvidence, type CapabilityEvidence } from "./googleCapabilityEvidence";
import { campaignTravelKeyConfigured } from "../integrations/googleMaps/campaignTravelAdapter";
import { CANONICAL_BUILDING_GEOGRAPHY } from "../../shared/canonicalGeography";

/**
 * Canonical building geography, derived from the single shared source of truth.
 *
 * The coordinates deliberately do NOT live here any more. `heading` is retained
 * under its historical name for existing server callers, but its value is the
 * building's physical facade heading, not a camera preference.
 */
export const CANONICAL_BUILDING_GEO = {
  opus_la: {
    id: CANONICAL_BUILDING_GEOGRAPHY.opus_la.id,
    name: CANONICAL_BUILDING_GEOGRAPHY.opus_la.name,
    address: CANONICAL_BUILDING_GEOGRAPHY.opus_la.address,
    latitude: CANONICAL_BUILDING_GEOGRAPHY.opus_la.latitude,
    longitude: CANONICAL_BUILDING_GEOGRAPHY.opus_la.longitude,
    heading: CANONICAL_BUILDING_GEOGRAPHY.opus_la.facadeHeading,
  },
  century_park_east: {
    id: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.id,
    name: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.name,
    address: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.address,
    latitude: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.latitude,
    longitude: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.longitude,
    heading: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.facadeHeading,
  },
} as const;

/** Evidence older than this no longer vouches for the API: the capability reads "stale" until a new call answers. */
export const CAPABILITY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * One capability's state from what Google actually answered: the newest of this process's telemetry and the evidence
 * kept across restarts. No credential: unconfigured. No answer yet: configured_not_yet_exercised. An answer older
 * than CAPABILITY_STALE_AFTER_MS: stale. Otherwise the newest answer's status, with its time.
 */
export function capabilityStateFrom(input: {
  name: GoogleCapabilityName;
  hasCredential: boolean;
  memory: GoogleTelemetryEvent | null;
  persisted: CapabilityEvidence | null;
  now: Date;
  coverageNotes?: string;
}): GoogleCapabilityState {
  const memoryAt = input.memory ? new Date(input.memory.timestamp) : null;
  const persistedAt = input.persisted?.lastCheckedAt ?? null;
  const useMemory = Boolean(memoryAt && (!persistedAt || memoryAt >= persistedAt));
  const checkedAt = useMemory ? memoryAt : persistedAt;
  const rawStatus = useMemory ? input.memory!.status : input.persisted?.lastStatus ?? null;
  const succeeded = useMemory ? input.memory!.success : rawStatus === "available";
  const lastSuccessAt = later(input.persisted?.lastSuccessAt ?? null, input.memory?.success ? memoryAt : null);
  const lastFailureAt = later(input.persisted?.lastFailureAt ?? null, input.memory && !input.memory.success ? memoryAt : null);
  const lastError = succeeded ? null : useMemory ? (input.memory!.error ?? null) : (input.persisted?.lastError ?? null);

  let status: GoogleCapabilityState["status"];
  if (!input.hasCredential) status = "unconfigured";
  else if (!checkedAt || !rawStatus) status = "configured_not_yet_exercised";
  else if (input.now.getTime() - checkedAt.getTime() > CAPABILITY_STALE_AFTER_MS) status = "stale";
  else if (rawStatus === "unavailable") status = "provider_error";
  else status = rawStatus;

  return {
    name: input.name,
    hasCredential: input.hasCredential,
    status,
    lastCheckedAt: checkedAt?.toISOString() ?? null,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: lastFailureAt?.toISOString() ?? null,
    lastLatencyMs: useMemory ? input.memory!.elapsedMs : (input.persisted?.lastLatencyMs ?? null),
    lastError,
    ...(input.coverageNotes ? { coverageNotes: input.coverageNotes } : {}),
    fallbackActive: status !== "available",
  };
}

export class GoogleWorldService {
  private geocoder: GoogleGeocoder;
  private addressValidator: GoogleAddressValidationService;
  private weatherService: GoogleWeatherService;
  private airQualityService: GoogleAirQualityService;
  private placesService: GooglePlacesService;
  private aggregateService: GooglePlacesAggregateService;
  private aerialService: GoogleAerialViewService;
  private streetViewService: GoogleStreetViewService;

  constructor() {
    // the fetch records what the Geocoding API answers (geocodingEvidence.ts)
    this.geocoder = new GoogleGeocoder(undefined, geocodingEvidenceFetch());
    this.addressValidator = new GoogleAddressValidationService();
    this.weatherService = new GoogleWeatherService();
    this.airQualityService = new GoogleAirQualityService();
    this.placesService = new GooglePlacesService();
    this.aggregateService = new GooglePlacesAggregateService();
    this.aerialService = new GoogleAerialViewService();
    this.streetViewService = new GoogleStreetViewService();
  }

  getPublicRuntimeConfig(): {
    mapsJavascriptApiKey: string | null;
    isMapsConfigured: boolean;
    isMapTilesConfigured: boolean;
    isAerialConfigured: boolean;
    isStreetViewConfigured: boolean;
  } {
    // Only the browser-intended Maps JS key is projected to the browser
    return {
      mapsJavascriptApiKey: ENV.googleMapsJavascriptApiKey.trim() || null,
      isMapsConfigured: Boolean(ENV.googleMapsJavascriptApiKey.trim()),
      isMapTilesConfigured: Boolean(ENV.googleMapTilesApiKey.trim()),
      isAerialConfigured: Boolean(ENV.googleAerialViewApiKey.trim()),
      isStreetViewConfigured: Boolean(ENV.googleStreetViewStaticApiKey.trim()),
    };
  }

  async getCapabilities(now = new Date()): Promise<GoogleWorldCapabilities> {
    // Status comes only from real answers: this process's telemetry and the evidence kept across restarts. A key
    // being present means configured, nothing more.
    const persisted = await loadCapabilityEvidence();
    const credentials: Record<GoogleCapabilityName, boolean> = {
      geocoding: Boolean(ENV.googleGeocodingApiKey.trim()),
      address_validation: Boolean(ENV.googleAddressValidationApiKey.trim()),
      places: Boolean(ENV.googlePlacesApiKey.trim()),
      places_aggregate: Boolean(ENV.googlePlacesAggregateApiKey.trim()),
      maps_javascript: Boolean(ENV.googleMapsJavascriptApiKey.trim()),
      map_tiles: Boolean(ENV.googleMapTilesApiKey.trim()),
      aerial_view: Boolean(ENV.googleAerialViewApiKey.trim()),
      street_view_static: Boolean(ENV.googleStreetViewStaticApiKey.trim()),
      weather: Boolean(ENV.googleWeatherApiKey.trim()),
      air_quality: Boolean(ENV.googleAirQualityApiKey.trim()),
      distance_matrix: campaignTravelKeyConfigured(),
    };
    const coverage: Partial<Record<GoogleCapabilityName, string>> = {
      aerial_view: "OPUS LA active, Century Park East coverage_missing",
      geocoding: "Address Validation is the primary geocode path; Geocoding is its fallback.",
      distance_matrix: "Legacy Distance Matrix API. Google's supported replacement is the Routes API (computeRouteMatrix).",
      maps_javascript: "Loaded in the browser; the server sees no calls, so it stays untested here.",
      map_tiles: "Loaded in the browser; the server sees no calls, so it stays untested here.",
    };
    const caps = Object.fromEntries(
      (Object.keys(credentials) as GoogleCapabilityName[]).map(name => [
        name,
        capabilityStateFrom({
          name,
          hasCredential: credentials[name],
          memory: latestGoogleTelemetry(name),
          persisted: persisted.get(name) ?? null,
          now,
          coverageNotes: coverage[name],
        }),
      ])
    ) as Record<GoogleCapabilityName, GoogleCapabilityState>;

    const states = Object.values(caps);
    const configuredCount = states.filter(c => c.hasCredential).length;
    let overallStatus: GoogleWorldCapabilities["overallStatus"] = "unconfigured";
    if (configuredCount === 0) overallStatus = "unconfigured";
    // fully operational only when every capability has recent evidence of working
    else if (states.every(c => c.status === "available")) overallStatus = "fully_operational";
    else overallStatus = "partially_degraded";

    return {
      generatedAt: now.toISOString(),
      capabilities: caps,
      overallStatus,
    };
  }

  async getAtmosphere(forceFresh = false): Promise<WorldAtmosphereProjection> {
    const [weatherResult, aqResult] = await Promise.all([
      this.weatherService.getCurrentLosAngelesWeather(forceFresh),
      this.airQualityService.getCurrentLosAngelesAirQuality(forceFresh),
    ]);

    return projectWorldAtmosphere({
      weather: weatherResult.weather,
      airQuality: aqResult.airQuality,
    });
  }

  /**
   * Google's building density beside this tenant's real customer presence. Presence comes from business records;
   * when it can't be read it is unknown, and the district glows for nothing rather than reading as unoccupied.
   */
  async getOpportunityPressure(
    tenantId: string,
    forceFresh = false,
    loadPresence: (tenantId: string) => Promise<DistrictPresence> = loadDistrictPresence
  ) {
    const goldlinePresence = await loadPresence(tenantId);
    return this.aggregateService.getLosAngelesOpportunityDensity({ forceFresh, goldlinePresence });
  }

  async getPlaceReality(placeIdOrBuildingId: string): Promise<{
    buildingId: string;
    place: GooglePlaceDetails | null;
    aerial: AerialViewResult | null;
    streetView: StreetViewFacadeResult | null;
  }> {
    const canonical = CANONICAL_BUILDING_GEO[placeIdOrBuildingId as keyof typeof CANONICAL_BUILDING_GEO];
    const targetAddress = canonical?.address ?? placeIdOrBuildingId;
    const targetBuildingId = canonical?.id ?? placeIdOrBuildingId;
    const targetLat = canonical?.latitude ?? 34.0522;
    const targetLng = canonical?.longitude ?? -118.2437;
    const heading = canonical?.heading;

    const [place, aerial, streetView] = await Promise.all([
      this.placesService.findPlaceByText(targetAddress),
      this.aerialService.lookupAerialVideo({
        buildingId: targetBuildingId,
        address: targetAddress,
      }),
      this.streetViewService.getBuildingFacade({
        buildingId: targetBuildingId,
        latitude: targetLat,
        longitude: targetLng,
        heading,
      }),
    ]);

    return {
      buildingId: targetBuildingId,
      place,
      aerial,
      streetView,
    };
  }

  async validateAndGeocodeAddress(address: string): Promise<{
    validation: AddressValidationResult;
    latitude: number | null;
    longitude: number | null;
    canonicalAddress: string;
    placeId: string | null;
    source: "address_validation_plus_geocoding" | "geocoding_only" | "unresolved";
  }> {
    // 1. First attempt Google Address Validation
    const validation = await this.addressValidator.validateAddress(address);

    if (validation.status === "success" && validation.latitude != null && validation.longitude != null) {
      return {
        validation,
        latitude: validation.latitude,
        longitude: validation.longitude,
        canonicalAddress: validation.formattedAddress,
        placeId: validation.placeId ?? null,
        source: "address_validation_plus_geocoding",
      };
    }

    // 2. Fallback to Google Geocoding with normalized or raw address
    const addressToGeocode = validation.status === "success" ? validation.formattedAddress : address;
    const geocode = await this.geocoder.geocode(addressToGeocode);

    if (geocode.status === "success") {
      return {
        validation,
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        canonicalAddress: geocode.canonicalAddress,
        placeId: geocode.googlePlaceId ?? null,
        source: "geocoding_only",
      };
    }

    return {
      validation,
      latitude: null,
      longitude: null,
      canonicalAddress: address,
      placeId: null,
      source: "unresolved",
    };
  }

  getTelemetry() {
    return getGoogleTelemetryLogs();
  }
}

export const googleWorldService = new GoogleWorldService();
