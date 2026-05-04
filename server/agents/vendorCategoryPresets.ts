export type VendorThemeKey = "clinical_minimalist" | "pixel_operations" | "standard";
export type VendorBookingMode = "instant" | "manual" | "hybrid" | "approval" | "recurring_contract";
export type VendorTrafficProtectionMode = "back_to_back" | "breathing_room" | "geo_clustered";

export type VendorCategoryPreset = {
  visibleLabel: string;
  internalCategoryKey: string;
  examples: string[];
  serviceTemplates: Array<{ name: string; durationMinutes: number; basePriceCents?: number }>;
  defaultAdminTheme: VendorThemeKey;
  enabledAdminSurfaces: string[];
  schedulingMode: VendorTrafficProtectionMode;
  defaultProviderResponseTimeoutMinutes: number;
  geoClusteringDefault: boolean;
  bookingConfirmationMode: VendorBookingMode;
  pricingRecommendationRules: "convenience_premium" | "route_density" | "standard";
  specialRequiredFields: string[];
  peerServicePermissions: string[];
  driverAppNeeded: boolean;
  buildingNativeService: "required" | "preferred" | "optional";
  gamifiedAdmin?: boolean;
};

export const vendorCategoryPresets = {
  beauty_mobile: {
    visibleLabel: "Hair Stylist",
    internalCategoryKey: "beauty_mobile",
    examples: ["Hair Stylist", "Facialist", "Makeup Artist", "Blowout Specialist"],
    serviceTemplates: [
      { name: "Haircut", durationMinutes: 60, basePriceCents: 10000 },
      { name: "Blowout", durationMinutes: 45, basePriceCents: 8500 },
      { name: "Color Consultation", durationMinutes: 30, basePriceCents: 0 },
    ],
    defaultAdminTheme: "clinical_minimalist",
    enabledAdminSurfaces: ["today", "bookings", "availability", "services", "clients", "payments", "request_service", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 120,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "convenience_premium",
    specialRequiredFields: [],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "required",
  },
  auto_detail: {
    visibleLabel: "Auto Detailer",
    internalCategoryKey: "auto_detail",
    examples: ["Auto Detailer"],
    serviceTemplates: [
      { name: "Exterior Detail", durationMinutes: 90, basePriceCents: 12500 },
      { name: "Full Detail", durationMinutes: 180, basePriceCents: 25000 },
    ],
    defaultAdminTheme: "clinical_minimalist",
    enabledAdminSurfaces: ["today", "bookings", "availability", "services", "payments", "location_notes", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 45,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "convenience_premium",
    specialRequiredFields: ["parking location", "valet instructions", "vehicle info"],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "required",
  },
  pet_care: {
    visibleLabel: "Pet Grooming",
    internalCategoryKey: "pet_care",
    examples: ["Pet Grooming", "Pet Pickup Grooming"],
    serviceTemplates: [
      { name: "Small Pet Groom", durationMinutes: 75, basePriceCents: 9500 },
      { name: "Large Pet Groom", durationMinutes: 120, basePriceCents: 15000 },
    ],
    defaultAdminTheme: "clinical_minimalist",
    enabledAdminSurfaces: ["bookings", "pet_profiles", "availability", "services", "payments", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 120,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "convenience_premium",
    specialRequiredFields: ["pet name", "breed", "size", "temperament", "vaccination notes"],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "preferred",
  },
  wellness_mobile: {
    visibleLabel: "Private Trainer",
    internalCategoryKey: "wellness_mobile",
    examples: ["Private Trainer", "Massage / Bodywork", "Yoga / Pilates"],
    serviceTemplates: [
      { name: "Private Session", durationMinutes: 60, basePriceCents: 15000 },
      { name: "Intro Consultation", durationMinutes: 30, basePriceCents: 0 },
    ],
    defaultAdminTheme: "clinical_minimalist",
    enabledAdminSurfaces: ["bookings", "availability", "clients", "packages", "payments", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 120,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "convenience_premium",
    specialRequiredFields: ["service location"],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "required",
  },
  residence_care: {
    visibleLabel: "Residence Care",
    internalCategoryKey: "residence_care",
    examples: ["Residence Care", "Studio Care", "Private Space Care", "Salon Maintenance"],
    serviceTemplates: [
      { name: "Private Space Care", durationMinutes: 120, basePriceCents: 18000 },
      { name: "Recurring Care Visit", durationMinutes: 120, basePriceCents: 16000 },
    ],
    defaultAdminTheme: "clinical_minimalist",
    enabledAdminSurfaces: ["bookings", "recurring_schedules", "availability", "payments", "request_service", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 120,
    geoClusteringDefault: true,
    bookingConfirmationMode: "approval",
    pricingRecommendationRules: "standard",
    specialRequiredFields: [],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "required",
  },
  route_operator: {
    visibleLabel: "Garment Care",
    internalCategoryKey: "route_operator",
    examples: ["Laundry / Dry Cleaning", "Garment Care", "Pickup / Dropoff service"],
    serviceTemplates: [
      { name: "Wash & Fold Pickup", durationMinutes: 15, basePriceCents: 0 },
      { name: "Dry Cleaning Pickup", durationMinutes: 15, basePriceCents: 0 },
    ],
    defaultAdminTheme: "pixel_operations",
    enabledAdminSurfaces: ["orders", "routes", "pickups", "processing", "payments", "collections", "level_4", "driver_missions"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 30,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "route_density",
    specialRequiredFields: [],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: true,
    buildingNativeService: "required",
    gamifiedAdmin: true,
  },
  generic_vendor: {
    visibleLabel: "Vendor",
    internalCategoryKey: "generic_vendor",
    examples: ["Floral / Plant Care", "Private Chef", "Tailoring"],
    serviceTemplates: [],
    defaultAdminTheme: "standard",
    enabledAdminSurfaces: ["bookings", "availability", "services", "payments", "request_service", "messages", "settings"],
    schedulingMode: "geo_clustered",
    defaultProviderResponseTimeoutMinutes: 120,
    geoClusteringDefault: true,
    bookingConfirmationMode: "hybrid",
    pricingRecommendationRules: "standard",
    specialRequiredFields: [],
    peerServicePermissions: ["request_service"],
    driverAppNeeded: false,
    buildingNativeService: "optional",
  },
} satisfies Record<string, VendorCategoryPreset>;

export type VendorCategoryPresetKey = keyof typeof vendorCategoryPresets;

export function getVendorCategoryPreset(key?: string | null): VendorCategoryPreset {
  if (key && key in vendorCategoryPresets) {
    return vendorCategoryPresets[key as VendorCategoryPresetKey];
  }
  return vendorCategoryPresets.generic_vendor;
}

export function detectVendorCategoryPreset(text: string): VendorCategoryPresetKey {
  const value = text.toLowerCase();
  if (/\b(hair|haircut|haircuts|stylist|salon|blowout|facial|makeup|beauty)\b/.test(value)) return "beauty_mobile";
  if (/\b(auto|car|detail|detailing|vehicle|valet)\b/.test(value)) return "auto_detail";
  if (/\b(pet|dog|cat|groom|grooming)\b/.test(value)) return "pet_care";
  if (/\b(trainer|training|massage|bodywork|yoga|pilates|wellness)\b/.test(value)) return "wellness_mobile";
  if (/\b(residence|studio|private space|salon maintenance|home organization|organization)\b/.test(value)) return "residence_care";
  if (/\b(laundry|dry cleaning|garment|pickup|dropoff|route)\b/.test(value)) return "route_operator";
  return "generic_vendor";
}

export function detectVendorOnboardingIntent(text: string): boolean {
  return /\b(join|onboard|offer|vendor|business|admin page|bookings?|service network|bldg\.chat)\b/i.test(text);
}

export const vendorOnboardingFirstQuestion =
  "Send your website, Instagram, or current booking page. I'll use it to prefill your services, pricing, hours, location, brand details, and photos. You can approve or correct everything before it goes live.";

export const noPublicSourceFallback = "No problem. I'll ask you the essentials.";

export const manualApprovalWarningCopy =
  "Manual approval gives you more control, but every minute the client waits increases the chance they look elsewhere. People are trained by Uber, DoorDash, and same-day booking apps to expect fast confirmation.";
