export const DAYFORGE_ENTITLEMENTS = [
  "dayforge_core",
  "territory_intelligence",
  "boreslay",
  "dayforge_field",
  "commercial_pipeline",
  "churn_radar",
] as const;

export type DayforgeEntitlement = (typeof DAYFORGE_ENTITLEMENTS)[number];

export const SAAS_SUBSCRIPTION_STATUSES = [
  "none",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "incomplete_expired",
  "canceled",
] as const;

export type SaasSubscriptionStatus =
  (typeof SAAS_SUBSCRIPTION_STATUSES)[number];

export type SaasTenantMemberRole = "owner" | "admin" | "operator" | "field";

export type TenantLocationConfiguration = {
  label: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  serviceRadiusMiles: number;
  maxPoundsPerDay: number;
  maxPoundsByWeekday: Record<string, number>;
  openCapacityPoundsPerWeek: number;
  pickupDays: string[];
  routeWindows: string[];
  turnaroundHours: number;
  deliveryEnabled: boolean;
};

export type TenantServiceConfiguration = {
  locationKey: string | null;
  serviceKey: string;
  name: string;
  enabled: boolean;
  commercialEnabled: boolean;
  pricePerPoundCents: number | null;
  minimumOrderCents: number | null;
  terms: string | null;
};

export type SaasTenantOnboardingConfiguration = {
  businessName: string;
  slug: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  timeZone: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  proposalTemplateKey: string | null;
  locations: TenantLocationConfiguration[];
  services: TenantServiceConfiguration[];
  importProviderKey: string | null;
};

export type SaasSubscriptionAccessInput = {
  status: SaasSubscriptionStatus;
  now?: Date;
  graceEndsAt?: Date | null;
  accessEndsAt?: Date | null;
};

export function normalizeSaasTenantSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function normalizeSaasEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function subscriptionAllowsDayforgeAccess(
  input: SaasSubscriptionStatus | SaasSubscriptionAccessInput
): boolean {
  const status = typeof input === "string" ? input : input.status;
  if (status === "trialing" || status === "active") return true;
  if (typeof input === "string") return false;

  const now = (input.now ?? new Date()).getTime();
  return (
    status === "past_due" &&
    !!input.graceEndsAt &&
    input.graceEndsAt.getTime() > now &&
    (!input.accessEndsAt || input.accessEndsAt.getTime() > now)
  );
}

export function onboardingConfigurationIsOperational(
  input: SaasTenantOnboardingConfiguration
): boolean {
  return (
    normalizeSaasTenantSlug(input.slug).length >= 3 &&
    input.locations.length > 0 &&
    input.services.some(service => service.enabled) &&
    input.services.every(
      service =>
        !service.locationKey ||
        input.locations.some(location => location.label === service.locationKey)
    ) &&
    input.locations.every(
      location =>
        location.maxPoundsPerDay > 0 &&
        Object.values(location.maxPoundsByWeekday).some(value => value > 0) &&
        location.openCapacityPoundsPerWeek >= 0 &&
        location.serviceRadiusMiles > 0 &&
        location.turnaroundHours > 0 &&
        location.pickupDays.length > 0 &&
        location.routeWindows.length > 0
    )
  );
}
