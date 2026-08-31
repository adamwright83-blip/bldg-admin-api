import { ENV } from "../_core/env";
import { GoogleGeocoder } from "../geography/googleGeocoder";
import { GoogleAddressValidationService, type AddressValidationResult } from "./googleAddressValidationService";
import { GoogleWeatherService } from "./googleWeatherService";
import { GoogleAirQualityService } from "./googleAirQualityService";
import { GooglePlacesService, type GooglePlaceDetails } from "./googlePlacesService";
import { GooglePlacesAggregateService } from "./googlePlacesAggregateService";
import { GoogleAerialViewService, type AerialViewResult } from "./googleAerialViewService";
import { GoogleStreetViewService, type StreetViewFacadeResult } from "./googleStreetViewService";
import {
  projectWorldAtmosphere,
  type WorldAtmosphereProjection,
} from "../../shared/worldAtmosphere";
import type {
  GoogleCapabilityName,
  GoogleCapabilityState,
  GoogleWorldCapabilities,
} from "../../shared/googleCapabilities";
import { getGoogleTelemetryLogs } from "./googleTelemetry";

export const CANONICAL_BUILDING_GEO = {
  opus_la: {
    id: "opus_la",
    name: "OPUS LA",
    address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    latitude: 34.0618,
    longitude: -118.3011,
    heading: 195,
  },
  century_park_east: {
    id: "century_park_east",
    name: "Century Park East",
    address: "2170 Century Park E, Los Angeles, CA 90067",
    latitude: 34.0591,
    longitude: -118.4147,
    heading: 140,
  },
} as const;

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
    this.geocoder = new GoogleGeocoder();
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

  async getCapabilities(): Promise<GoogleWorldCapabilities> {
    const caps: Record<GoogleCapabilityName, GoogleCapabilityState> = {
      geocoding: {
        name: "geocoding",
        hasCredential: Boolean(ENV.googleGeocodingApiKey.trim()),
        status: ENV.googleGeocodingApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleGeocodingApiKey.trim(),
      },
      address_validation: {
        name: "address_validation",
        hasCredential: Boolean(ENV.googleAddressValidationApiKey.trim()),
        status: ENV.googleAddressValidationApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleAddressValidationApiKey.trim(),
      },
      places: {
        name: "places",
        hasCredential: Boolean(ENV.googlePlacesApiKey.trim()),
        status: ENV.googlePlacesApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googlePlacesApiKey.trim(),
      },
      places_aggregate: {
        name: "places_aggregate",
        hasCredential: Boolean((ENV.googlePlacesAggregateApiKey || ENV.googlePlacesApiKey).trim()),
        status: (ENV.googlePlacesAggregateApiKey || ENV.googlePlacesApiKey).trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !(ENV.googlePlacesAggregateApiKey || ENV.googlePlacesApiKey).trim(),
      },
      maps_javascript: {
        name: "maps_javascript",
        hasCredential: Boolean(ENV.googleMapsJavascriptApiKey.trim()),
        status: ENV.googleMapsJavascriptApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleMapsJavascriptApiKey.trim(),
      },
      map_tiles: {
        name: "map_tiles",
        hasCredential: Boolean(ENV.googleMapTilesApiKey.trim()),
        status: ENV.googleMapTilesApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleMapTilesApiKey.trim(),
      },
      aerial_view: {
        name: "aerial_view",
        hasCredential: Boolean(ENV.googleAerialViewApiKey.trim()),
        status: ENV.googleAerialViewApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        coverageNotes: "OPUS LA and Century Park East coverage checked dynamically",
        fallbackActive: !ENV.googleAerialViewApiKey.trim(),
      },
      street_view_static: {
        name: "street_view_static",
        hasCredential: Boolean(ENV.googleStreetViewStaticApiKey.trim()),
        status: ENV.googleStreetViewStaticApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleStreetViewStaticApiKey.trim(),
      },
      weather: {
        name: "weather",
        hasCredential: Boolean(ENV.googleWeatherApiKey.trim()),
        status: ENV.googleWeatherApiKey.trim() ? "available" : "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleWeatherApiKey.trim(),
      },
      air_quality: {
        name: "air_quality",
        hasCredential: Boolean(ENV.googleAirQualityApiKey.trim()),
        status: ENV.googleAirQualityApiKey.trim() ? "available" : "unconfigured",
        lastCheckedAt: new Date().toISOString(),
        lastLatencyMs: null,
        lastError: null,
        fallbackActive: !ENV.googleAirQualityApiKey.trim(),
      },
    };

    const configuredCount = Object.values(caps).filter(c => c.hasCredential).length;
    let overallStatus: GoogleWorldCapabilities["overallStatus"] = "unconfigured";
    if (configuredCount === 10) overallStatus = "fully_operational";
    else if (configuredCount > 0) overallStatus = "partially_degraded";

    return {
      generatedAt: new Date().toISOString(),
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

  async getOpportunityPressure(forceFresh = false) {
    return this.aggregateService.getLosAngelesOpportunityDensity({ forceFresh });
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
