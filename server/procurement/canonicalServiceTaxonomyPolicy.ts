export const CANONICAL_SERVICE_CATEGORIES = [
  "laundry",
  "dry_cleaning",
  "dog_grooming",
  "car_detail",
  "airport_transport",
  "apartment_cleaning",
  "guest_readiness",
  "haircut",
  "handyman",
  "other",
] as const;

export type CanonicalServiceCategory = (typeof CANONICAL_SERVICE_CATEGORIES)[number];

export type CanonicalRequestPath =
  | "established_order"
  | "coordinated_request"
  | "planning_only"
  | "manual_review";

export type CanonicalServiceDefinition = {
  category: CanonicalServiceCategory;
  label: string;
  requestPath: CanonicalRequestPath;
  providerConfirmationRequired: boolean;
  bookingMayBeInferred: false;
};

export type CanonicalServiceIntent = CanonicalServiceDefinition & {
  recognized: boolean;
  sourceIntent: string | null;
  reasons: string[];
};

const DEFINITIONS: Readonly<Record<CanonicalServiceCategory, CanonicalServiceDefinition>> = {
  laundry: definition("laundry", "Laundry", "established_order", true),
  dry_cleaning: definition("dry_cleaning", "Dry Cleaning", "coordinated_request", true),
  dog_grooming: definition("dog_grooming", "Dog Grooming", "coordinated_request", true),
  car_detail: definition("car_detail", "Car Detail", "coordinated_request", true),
  airport_transport: definition("airport_transport", "Airport Transport", "coordinated_request", true),
  apartment_cleaning: definition("apartment_cleaning", "Apartment Cleaning", "coordinated_request", true),
  guest_readiness: definition("guest_readiness", "Guest Readiness", "planning_only", true),
  haircut: definition("haircut", "Haircut", "manual_review", true),
  handyman: definition("handyman", "Handyman", "manual_review", true),
  other: definition("other", "Other Service", "manual_review", true),
};

const ALIASES: Readonly<Record<string, CanonicalServiceCategory>> = {
  laundry: "laundry",
  laundry_pickup: "laundry",
  wash_fold: "laundry",
  wash_and_fold: "laundry",
  "dry-cleaning-request": "dry_cleaning",
  dry_cleaning: "dry_cleaning",
  dry_clean: "dry_cleaning",
  "dog-grooming-request": "dog_grooming",
  dog_grooming: "dog_grooming",
  grooming: "dog_grooming",
  "car-wash-request": "car_detail",
  car_detail: "car_detail",
  "car-wash": "car_detail",
  car_wash: "car_detail",
  "airport-transport-request": "airport_transport",
  airport_transport: "airport_transport",
  "cleaning-request": "apartment_cleaning",
  apartment_cleaning: "apartment_cleaning",
  cleaning: "apartment_cleaning",
  "guest-preparation-request": "guest_readiness",
  guest_readiness: "guest_readiness",
  guest_preparation: "guest_readiness",
  haircut: "haircut",
  handyman: "handyman",
  other: "other",
};

function definition(
  category: CanonicalServiceCategory,
  label: string,
  requestPath: CanonicalRequestPath,
  providerConfirmationRequired: boolean,
): CanonicalServiceDefinition {
  return { category, label, requestPath, providerConfirmationRequired, bookingMayBeInferred: false };
}

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().toLowerCase().replace(/\s+/g, "_");
  return result || null;
}

export function getCanonicalServiceDefinition(
  category: CanonicalServiceCategory,
): CanonicalServiceDefinition {
  return { ...DEFINITIONS[category] };
}

/**
 * Canonicalizes the vocabularies already emitted by resident intent detection,
 * multi-intent plans, coordinated requests, and established laundry intake.
 * It classifies only; it never routes, books, contacts, charges, or mutates.
 */
export function canonicalizeServiceIntent(value: unknown): CanonicalServiceIntent {
  const sourceIntent = normalized(value);
  const category = sourceIntent ? ALIASES[sourceIntent] : undefined;
  if (!category) {
    return {
      ...DEFINITIONS.other,
      recognized: false,
      sourceIntent,
      reasons: [sourceIntent ? "service_intent_unrecognized" : "service_intent_missing"],
    };
  }
  return { ...DEFINITIONS[category], recognized: true, sourceIntent, reasons: [] };
}
