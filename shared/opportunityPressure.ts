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
  /** Multi-family buildings Google counted in the district; null when the count is unknown (the query failed) */
  multiFamilyDensityCount: number | null;
  /** Active customers located in the district from business records; null when presence couldn't be read */
  goldlineCustomerCount: number | null;
  /** goldline / multiFamily; null when either is unknown or there are no buildings to divide by */
  penetrationRatio: number | null;
  /** "unknown" when either input is unknown: no glow is invented for a district JOYSTICK can't measure */
  opportunityPressure: "unexplored" | "high_potential" | "contested" | "stronghold" | "unknown";
  intensityScore: number; // 0.0 to 1.0 for visual glow
};

export type TerritoryOpportunityProjection = {
  generatedAt: string;
  districts: DistrictOpportunityMetric[];
  /** sum of the districts whose count is known */
  totalHousingCount: number;
  /** districts whose building count is unknown; totalHousingCount leaves them out */
  unknownHousingDistrictCount: number;
  unexploredDistrictCount: number;
  source: "places_aggregate" | "baseline_density";
};

export function computeOpportunityPressure(input: {
  districts: Array<{
    districtId: string;
    /** null: unknown, never a stand-in number */
    housingCount: number | null;
    /** null: unknown, never treated as "no customers" */
    activeCustomerCount: number | null;
  }>;
  source?: "places_aggregate" | "baseline_density";
}): TerritoryOpportunityProjection {
  const source = input.source ?? "baseline_density";
  let totalHousing = 0;
  let unknownHousing = 0;
  let unexploredCount = 0;

  const districtMetrics: DistrictOpportunityMetric[] = STRATEGIC_LA_DISTRICTS.map(district => {
    const data = input.districts.find(d => d.districtId === district.id);
    const housing = data?.housingCount ?? null;
    const customers = data?.activeCustomerCount ?? null;
    if (housing == null) unknownHousing += 1;
    else totalHousing += housing;

    const base = { districtId: district.id, name: district.name, center: district.center, atlasAnchor: district.atlasAnchor };
    if (housing == null || customers == null) {
      return {
        ...base,
        multiFamilyDensityCount: housing,
        goldlineCustomerCount: customers,
        penetrationRatio: null,
        opportunityPressure: "unknown",
        intensityScore: 0,
      };
    }

    const ratio = housing > 0 ? customers / housing : null;
    let pressure: DistrictOpportunityMetric["opportunityPressure"];
    let intensity: number;
    if (customers === 0) {
      pressure = "unexplored";
      // a district with no multi-family buildings has nothing to explore
      intensity = housing > 0 ? 0.4 : 0;
      unexploredCount += 1;
    } else if (ratio == null || ratio >= 0.30) {
      pressure = "stronghold";
      intensity = 0.30;
    } else if (ratio < 0.15) {
      pressure = "high_potential";
      intensity = 0.85; // Strong unexplored strategic glow
    } else {
      pressure = "contested";
      intensity = 0.60;
    }

    return {
      ...base,
      multiFamilyDensityCount: housing,
      goldlineCustomerCount: customers,
      penetrationRatio: ratio,
      opportunityPressure: pressure,
      intensityScore: intensity,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    districts: districtMetrics,
    totalHousingCount: totalHousing,
    unknownHousingDistrictCount: unknownHousing,
    unexploredDistrictCount: unexploredCount,
    source,
  };
}
