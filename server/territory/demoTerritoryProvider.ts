import type {
  GeoPoint,
  TerritoryBusinessCandidate,
  TerritoryBusinessProvider,
} from "./territoryDiscovery";

const DEFAULT_CENTER: GeoPoint = {
  lat: 34.076,
  lng: -118.259,
  formattedAddress: "Los Angeles, CA",
};

const CANDIDATES: TerritoryBusinessCandidate[] = [
  {
    providerId: "demo-westview-property-management",
    name: "Westview Property Management",
    formattedAddress: "Los Angeles, CA",
    lat: 34.078,
    lng: -118.257,
    categories: ["property management", "apartment portfolio"],
    website: "https://example.com/westview",
    phone: "3235550142",
    locationCount: 15,
    growthSignal: "Expanded to 15 buildings",
    decisionMakerName: "Dana R.",
    decisionMakerTitle: "Operations Manager",
  },
  {
    providerId: "demo-harbor-inn",
    name: "Harbor Inn & Suites",
    formattedAddress: "Los Angeles, CA",
    lat: 34.082,
    lng: -118.255,
    categories: ["hotel"],
    website: "https://example.com/harbor",
    phone: "3235550182",
    locationCount: 1,
    roomCount: 40,
    recentlyOpened: true,
    growthSignal: "Housekeeping team hiring",
  },
  {
    providerId: "demo-glow-salon",
    name: "Glow Salon Group",
    formattedAddress: "Los Angeles, CA",
    lat: 34.071,
    lng: -118.248,
    categories: ["salon", "spa"],
    website: "https://example.com/glow",
    locationCount: 3,
    growthSignal: "Opened a third location",
  },
  {
    providerId: "demo-iron-tide-gym",
    name: "Iron Tide Gym",
    formattedAddress: "Los Angeles, CA",
    lat: 34.069,
    lng: -118.267,
    categories: ["gym", "fitness"],
    phone: "3235550166",
    locationCount: 1,
    growthSignal: "Membership growth announcement",
  },
];

export class DemoTerritoryProvider implements TerritoryBusinessProvider {
  async geocode(addressOrBusiness: string): Promise<GeoPoint> {
    return {
      ...DEFAULT_CENTER,
      formattedAddress: addressOrBusiness.trim() || DEFAULT_CENTER.formattedAddress,
    };
  }

  async searchBusinesses(): Promise<TerritoryBusinessCandidate[]> {
    return CANDIDATES.map(candidate => ({ ...candidate }));
  }
}
