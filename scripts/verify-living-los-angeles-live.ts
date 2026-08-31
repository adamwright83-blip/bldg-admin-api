import { GoogleWeatherService } from "../server/google/googleWeatherService";
import { GoogleAirQualityService } from "../server/google/googleAirQualityService";
import { GoogleAddressValidationService } from "../server/google/googleAddressValidationService";
import { GooglePlacesService } from "../server/google/googlePlacesService";
import { GooglePlacesAggregateService } from "../server/google/googlePlacesAggregateService";
import { GoogleAerialViewService } from "../server/google/googleAerialViewService";
import { GoogleStreetViewService } from "../server/google/googleStreetViewService";
import { GoogleGeocoder } from "../server/geography/googleGeocoder";
import { GoogleWorldService } from "../server/google/googleWorldService";
import { projectWorldAtmosphere } from "../shared/worldAtmosphere";

async function main() {
  console.log("============================================================");
  console.log("LIVING LOS ANGELES — LIVE RAILWAY GOOGLE API EXERCISE AUDIT");
  console.log("============================================================");

  const worldService = new GoogleWorldService();
  const caps = await worldService.getCapabilities();
  console.log("\n1. CAPABILITY CONFIGURATION CHECK:");
  for (const [name, cap] of Object.entries(caps.capabilities)) {
    console.log(`  - ${name.padEnd(22)}: credential=${cap.hasCredential ? "YES" : "NO"} | status=${cap.status}`);
  }

  // 1. Google Weather
  console.log("\n2. LIVE GOOGLE WEATHER PROBE:");
  const weatherService = new GoogleWeatherService();
  const t0 = performance.now();
  const weatherResult = await weatherService.getCurrentLosAngelesWeather(true);
  const weatherMs = Math.round(performance.now() - t0);
  console.log(`  Status: ${weatherResult.status} | Latency: ${weatherMs}ms | CacheHit: ${weatherResult.cacheHit}`);
  console.log(`  Source: ${weatherResult.weather.source} | Condition: ${weatherResult.weather.condition} | Temp: ${weatherResult.weather.temperatureFahrenheit}°F | Cloud: ${weatherResult.weather.cloudCoverPercent}% | Raining: ${weatherResult.weather.isRaining}`);

  // 2. Google Air Quality
  console.log("\n3. LIVE GOOGLE AIR QUALITY PROBE:");
  const aqService = new GoogleAirQualityService();
  const t1 = performance.now();
  const aqResult = await aqService.getCurrentLosAngelesAirQuality(true);
  const aqMs = Math.round(performance.now() - t1);
  console.log(`  Status: ${aqResult.status} | Latency: ${aqMs}ms | CacheHit: ${aqResult.cacheHit}`);
  console.log(`  Source: ${aqResult.airQuality.source} | AQI: ${aqResult.airQuality.aqi ?? "null (unmodulated)"} | Category: ${aqResult.airQuality.category} | Pollutant: ${aqResult.airQuality.dominantPollutant ?? "none"}`);

  // Compute live atmosphere projection
  const atmo = projectWorldAtmosphere({
    weather: weatherResult.weather,
    airQuality: aqResult.airQuality,
  });
  console.log(`  Atmosphere Badge: "${atmo.statusBadge}"`);
  console.log(`  CSS Variables: --world-cloud=${atmo.cssVariables["--world-cloud"]}, --world-haze=${atmo.cssVariables["--world-haze"]}, --world-visibility=${atmo.cssVariables["--world-visibility"]}, --world-wetness=${atmo.cssVariables["--world-wetness"]}`);

  // 3. Geocoding
  console.log("\n4. LIVE GOOGLE GEOCODING PROBE:");
  const geocoder = new GoogleGeocoder();
  const t2a = performance.now();
  const geoOpus = await geocoder.geocode("3545 Wilshire Blvd, Los Angeles, CA 90010");
  const geoOpusMs = Math.round(performance.now() - t2a);
  console.log(`  OPUS LA: status=${geoOpus.status} | Latency=${geoOpusMs}ms`);
  if (geoOpus.status === "success") {
    console.log(`    Canonical Address: ${geoOpus.canonicalAddress} | Lat/Lng: ${geoOpus.latitude}, ${geoOpus.longitude} | PlaceId: ${geoOpus.googlePlaceId}`);
  }

  const t2b = performance.now();
  const geoCpe = await geocoder.geocode("2170 Century Park E, Los Angeles, CA 90067");
  const geoCpeMs = Math.round(performance.now() - t2b);
  console.log(`  Century Park East: status=${geoCpe.status} | Latency=${geoCpeMs}ms`);
  if (geoCpe.status === "success") {
    console.log(`    Canonical Address: ${geoCpe.canonicalAddress} | Lat/Lng: ${geoCpe.latitude}, ${geoCpe.longitude} | PlaceId: ${geoCpe.googlePlaceId}`);
  }

  // 4. Address Validation
  console.log("\n5. LIVE GOOGLE ADDRESS VALIDATION PROBE:");
  const valService = new GoogleAddressValidationService();
  const t3a = performance.now();
  const valOpus = await valService.validateAddress("3545 Wilshire Blvd, Los Angeles, CA 90010");
  const valOpusMs = Math.round(performance.now() - t3a);
  console.log(`  OPUS LA: status=${valOpus.status} | Latency=${valOpusMs}ms`);
  if (valOpus.status === "success") {
    console.log(`    Formatted: ${valOpus.formattedAddress} | Complete: ${valOpus.isComplete} | Granularity: ${valOpus.granularity}`);
  }

  const t3b = performance.now();
  const valCpe = await valService.validateAddress("2170 Century Park E, Los Angeles, CA 90067");
  const valCpeMs = Math.round(performance.now() - t3b);
  console.log(`  Century Park East: status=${valCpe.status} | Latency=${valCpeMs}ms`);
  if (valCpe.status === "success") {
    console.log(`    Formatted: ${valCpe.formattedAddress} | Complete: ${valCpe.isComplete} | Granularity: ${valCpe.granularity}`);
  }

  // 5. Places (New)
  console.log("\n6. LIVE GOOGLE PLACES (NEW) PROBE:");
  const placesService = new GooglePlacesService();
  const t4a = performance.now();
  const placeOpus = await placesService.findPlaceByText("OPUS 3545 Wilshire Blvd Los Angeles");
  const placeOpusMs = Math.round(performance.now() - t4a);
  console.log(`  OPUS LA: found=${Boolean(placeOpus)} | Latency=${placeOpusMs}ms`);
  if (placeOpus) {
    console.log(`    Display Name: ${placeOpus.displayName} | PlaceId: ${placeOpus.id} | Type: ${placeOpus.primaryType}`);
    console.log(`    Photo Attribution: ${placeOpus.primaryPhotoAttribution?.displayName ?? "none"}`);
  }

  const t4b = performance.now();
  const placeCpe = await placesService.findPlaceByText("Century Park East 2170 Century Park E Los Angeles");
  const placeCpeMs = Math.round(performance.now() - t4b);
  console.log(`  Century Park East: found=${Boolean(placeCpe)} | Latency=${placeCpeMs}ms`);
  if (placeCpe) {
    console.log(`    Display Name: ${placeCpe.displayName} | PlaceId: ${placeCpe.id} | Type: ${placeCpe.primaryType}`);
    console.log(`    Photo Attribution: ${placeCpe.primaryPhotoAttribution?.displayName ?? "none"}`);
  }

  // 6. Places Aggregate
  console.log("\n7. LIVE GOOGLE PLACES AGGREGATE PROBE:");
  const aggService = new GooglePlacesAggregateService();
  const t5 = performance.now();
  const aggResult = await aggService.getLosAngelesOpportunityDensity({ forceFresh: true });
  const aggMs = Math.round(performance.now() - t5);
  console.log(`  Status: ${aggResult.status} | Latency: ${aggMs}ms | Source: ${aggResult.projection.source}`);
  console.log(`  Total Housing Density: ${aggResult.projection.totalHousingCount} across ${aggResult.projection.districts.length} districts`);
  for (const d of aggResult.projection.districts.slice(0, 4)) {
    console.log(`    - ${d.name.padEnd(16)}: ${d.multiFamilyDensityCount} units | pressure=${d.opportunityPressure} | intensity=${d.intensityScore}`);
  }

  // 7. Street View Static
  console.log("\n8. LIVE GOOGLE STREET VIEW STATIC PROBE:");
  const svService = new GoogleStreetViewService();
  const t6a = performance.now();
  const svOpus = await svService.getBuildingFacade({ buildingId: "opus_la", latitude: 34.0618, longitude: -118.3011, heading: 195 });
  const svOpusMs = Math.round(performance.now() - t6a);
  console.log(`  OPUS LA: status=${svOpus.status} | Coverage=${svOpus.hasCoverage} | Latency=${svOpusMs}ms | Attribution: "${svOpus.attributionText}"`);

  const t6b = performance.now();
  const svCpe = await svService.getBuildingFacade({ buildingId: "century_park_east", latitude: 34.0591, longitude: -118.4147, heading: 140 });
  const svCpeMs = Math.round(performance.now() - t6b);
  console.log(`  Century Park East: status=${svCpe.status} | Coverage=${svCpe.hasCoverage} | Latency=${svCpeMs}ms | Attribution: "${svCpe.attributionText}"`);

  // 8. Aerial View
  console.log("\n9. LIVE GOOGLE AERIAL VIEW PROBE:");
  const aerialService = new GoogleAerialViewService();
  const t7a = performance.now();
  const aerialOpus = await aerialService.lookupAerialVideo({ buildingId: "opus_la", address: "3545 Wilshire Blvd, Los Angeles, CA 90010" });
  const aerialOpusMs = Math.round(performance.now() - t7a);
  console.log(`  OPUS LA: status=${aerialOpus.status} | Latency=${aerialOpusMs}ms`);

  const t7b = performance.now();
  const aerialCpe = await aerialService.lookupAerialVideo({ buildingId: "century_park_east", address: "2170 Century Park E, Los Angeles, CA 90067" });
  const aerialCpeMs = Math.round(performance.now() - t7b);
  console.log(`  Century Park East: status=${aerialCpe.status} | Latency=${aerialCpeMs}ms`);

  console.log("\n============================================================");
  console.log("AUDIT SUMMARY COMPLETE");
  console.log("============================================================");
}

main().catch(err => {
  console.error("Live verification error:", err);
  process.exit(1);
});
