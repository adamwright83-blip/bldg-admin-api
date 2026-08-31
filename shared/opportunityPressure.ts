/**
 * Places Aggregate — The Unwritten Map.
 * Projects strategic opportunity density across Los Angeles territory.
 *
 * ABSOLUTE RULE:
 * Opportunity density modulates territory pressure and unexplored glow.
 * It NEVER creates a fake lead, prospect, or building entity.
 */

export type StrategicDistrict = {
  id: string;
  name: string;
  center: { latitude: number; longitude: number };
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  atlasAnchor: { x: number; y: number }; // Relative percentage on atlas
};

export const STRATEGIC_LA_DISTRICTS: StrategicDistrict[] = [
  {
    id: "koreatown",
    name: "Koreatown",
    center: { latitude: 34.0578, longitude: -118.3009 },
    bounds: { north: 34.072, south: 34.045, east: -118.285, west: -118.318 },
    atlasAnchor: { x: 51, y: 70 },
  },
  {
    id: "century_city",
    name: "Century City",
    center: { latitude: 34.0537, longitude: -118.4134 },
    bounds: { north: 34.068, south: 34.042, east: -118.398, west: -118.428 },
    atlasAnchor: { x: 12, y: 76 },
  },
  {
    id: "west_hollywood",
    name: "West Hollywood",
    center: { latitude: 34.0900, longitude: -118.3617 },
    bounds: { north: 34.105, south: 34.075, east: -118.345, west: -118.385 },
    atlasAnchor: { x: 18, y: 18 },
  },
  {
    id: "beverly_hills",
    name: "Beverly Hills",
    center: { latitude: 34.0736, longitude: -118.4004 },
    bounds: { north: 34.090, south: 34.055, east: -118.380, west: -118.420 },
    atlasAnchor: { x: 13, y: 43 },
  },
  {
    id: "hollywood",
    name: "Hollywood",
    center: { latitude: 34.0928, longitude: -118.3287 },
    bounds: { north: 34.110, south: 34.080, east: -118.310, west: -118.350 },
    atlasAnchor: { x: 47, y: 34 },
  },
  {
    id: "silver_lake",
    name: "Silver Lake",
    center: { latitude: 34.0869, longitude: -118.2702 },
    bounds: { north: 34.102, south: 34.070, east: -118.250, west: -118.290 },
    atlasAnchor: { x: 82, y: 43 },
  },
  {
    id: "echo_park",
    name: "Echo Park",
    center: { latitude: 34.0782, longitude: -118.2606 },
    bounds: { north: 34.092, south: 34.065, east: -118.245, west: -118.278 },
    atlasAnchor: { x: 86, y: 72 },
  },
  {
    id: "los_feliz",
    name: "Los Feliz",
    center: { latitude: 34.1182, longitude: -118.2865 },
    bounds: { north: 34.135, south: 34.100, east: -118.265, west: -118.310 },
    atlasAnchor: { x: 76, y: 20 },
  },
  {
    id: "downtown_la",
    name: "Downtown LA",
    center: { latitude: 34.0407, longitude: -118.2468 },
    bounds: { north: 34.060, south: 34.025, east: -118.230, west: -118.270 },
    atlasAnchor: { x: 92, y: 88 },
  },
];

export type DistrictOpportunityMetric = {
  districtId: string;
  name: string;
  center: { latitude: number; longitude: number };
  atlasAnchor: { x: number; y: number };
  multiFamilyDensityCount: number; // Multi-family building aggregate from Places
  goldlineCustomerCount: number;
  penetrationRatio: number; // goldline / multiFamily
  opportunityPressure: "unexplored" | "high_potential" | "contested" | "stronghold";
  intensityScore: number; // 0.0 to 1.0 for visual glow
};

export type TerritoryOpportunityProjection = {
  generatedAt: string;
  districts: DistrictOpportunityMetric[];
  totalHousingCount: number;
  unexploredDistrictCount: number;
  source: "places_aggregate" | "baseline_density";
};

export function computeOpportunityPressure(input: {
  districts: Array<{
    districtId: string;
    housingCount: number;
    activeCustomerCount: number;
  }>;
  source?: "places_aggregate" | "baseline_density";
}): TerritoryOpportunityProjection {
  const source = input.source ?? "baseline_density";
  let totalHousing = 0;
  let unexploredCount = 0;

  const districtMetrics: DistrictOpportunityMetric[] = STRATEGIC_LA_DISTRICTS.map(district => {
    const data = input.districts.find(d => d.districtId === district.id);
    const multiFamilyDensityCount = Math.max(1, data?.housingCount ?? 50);
    const goldlineCustomerCount = data?.activeCustomerCount ?? 0;
    totalHousing += multiFamilyDensityCount;

    const ratio = goldlineCustomerCount / multiFamilyDensityCount;
    let pressure: DistrictOpportunityMetric["opportunityPressure"] = "unexplored";
    let intensity = 0.2;

    if (goldlineCustomerCount === 0) {
      pressure = "unexplored";
      intensity = 0.4;
      unexploredCount += 1;
    } else if (ratio < 0.15) {
      pressure = "high_potential";
      intensity = 0.85; // Strong unexplored strategic glow
    } else if (ratio < 0.30) {
      pressure = "contested";
      intensity = 0.60;
    } else {
      pressure = "stronghold";
      intensity = 0.30;
    }

    return {
      districtId: district.id,
      name: district.name,
      center: district.center,
      atlasAnchor: district.atlasAnchor,
      multiFamilyDensityCount,
      goldlineCustomerCount,
      penetrationRatio: ratio,
      opportunityPressure: pressure,
      intensityScore: intensity,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    districts: districtMetrics,
    totalHousingCount: totalHousing,
    unexploredDistrictCount: unexploredCount,
    source,
  };
}
