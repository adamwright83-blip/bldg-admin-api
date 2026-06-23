import type { CanonicalServiceCategory } from "./canonicalServiceTaxonomyPolicy";

export type RequestFactKey =
  | "location"
  | "requested_date"
  | "requested_window"
  | "deadline"
  | "service_details"
  | "dog_size_or_breed"
  | "vehicle_details"
  | "origin"
  | "destination";

export type CanonicalRequestFacts = {
  buildingSlug?: string | null;
  address?: string | null;
  unit?: string | null;
  requestedDate?: string | null;
  requestedWindow?: string | null;
  deadlineDate?: string | null;
  serviceDetails?: string | null;
  vehicleDetails?: string | null;
  origin?: string | null;
  destination?: string | null;
  dog?: {
    name?: string | null;
    breed?: string | null;
    weight?: string | null;
    size?: "small" | "medium" | "large" | "extra_large" | string | null;
    ageOrLifeStage?: string | null;
    temperament?: string | null;
    handlingNotes?: string | null;
    negativeConstraints?: string[] | null;
  } | null;
  budget?: string | null;
};

export type RequestCompletenessResult = {
  status: "complete_for_job_card" | "needs_clarification";
  category: CanonicalServiceCategory;
  missingRequiredFacts: RequestFactKey[];
  missingOptionalFacts: RequestFactKey[];
  nextQuestionKey: RequestFactKey | null;
  nextQuestion: string | null;
  mayCreateJobCard: boolean;
  maySourceVendor: false;
  mayBook: false;
};

type Requirement = { key: RequestFactKey; present: (facts: CanonicalRequestFacts) => boolean; question: string };

const present = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const locationPresent = (facts: CanonicalRequestFacts) => present(facts.buildingSlug) || present(facts.address);
const dateOrDeadlinePresent = (facts: CanonicalRequestFacts) => present(facts.requestedDate) || present(facts.deadlineDate);

const REQUIREMENTS: Readonly<Record<CanonicalServiceCategory, readonly Requirement[]>> = {
  laundry: [requirement("location", locationPresent, "Which building or address is this for?")],
  dry_cleaning: [
    requirement("location", locationPresent, "Which building or address is this for?"),
    requirement("service_details", facts => present(facts.serviceDetails), "What items need dry cleaning?"),
  ],
  dog_grooming: [
    requirement("location", locationPresent, "Which building or address is this for?"),
    requirement("requested_date", dateOrDeadlinePresent, "What day should I look for grooming availability?"),
    requirement("dog_size_or_breed", facts => present(facts.dog?.size) || present(facts.dog?.breed),
      "What size or breed is your dog?"),
  ],
  car_detail: [
    requirement("location", locationPresent, "Where will the vehicle be parked?"),
    requirement("requested_date", dateOrDeadlinePresent, "What day should I look for detailing availability?"),
    requirement("vehicle_details", facts => present(facts.vehicleDetails), "What kind of vehicle needs detailing?"),
  ],
  airport_transport: [
    requirement("requested_date", dateOrDeadlinePresent, "What date is the airport trip?"),
    requirement("origin", facts => present(facts.origin), "Where should the ride start?"),
    requirement("destination", facts => present(facts.destination), "Where is the ride going?"),
    requirement("requested_window", facts => present(facts.requestedWindow), "What pickup time do you need?"),
  ],
  apartment_cleaning: [
    requirement("location", locationPresent, "Which apartment or address needs cleaning?"),
    requirement("requested_date", dateOrDeadlinePresent, "What day should I look for cleaning availability?"),
  ],
  guest_readiness: [
    requirement("location", locationPresent, "Which home is this for?"),
    requirement("deadline", facts => present(facts.deadlineDate), "When must everything be ready?"),
    requirement("service_details", facts => present(facts.serviceDetails), "What needs to be ready for your guest?"),
  ],
  haircut: [
    requirement("location", locationPresent, "Which building or area is this for?"),
    requirement("requested_date", dateOrDeadlinePresent, "What day should I look for an appointment?"),
  ],
  handyman: [
    requirement("location", locationPresent, "Which unit or address needs the work?"),
    requirement("service_details", facts => present(facts.serviceDetails), "What needs to be repaired or installed?"),
  ],
  other: [
    requirement("service_details", facts => present(facts.serviceDetails), "What would you like HELD to arrange?"),
    requirement("location", locationPresent, "Which building or address is this for?"),
  ],
};

const OPTIONAL: Readonly<Partial<Record<CanonicalServiceCategory, readonly RequestFactKey[]>>> = {
  laundry: ["requested_date", "requested_window", "service_details"],
  dry_cleaning: ["requested_date", "requested_window", "deadline"],
  dog_grooming: ["requested_window", "service_details"],
  car_detail: ["requested_window", "service_details"],
  apartment_cleaning: ["requested_window", "service_details"],
  haircut: ["requested_window", "service_details"],
};

function requirement(key: RequestFactKey, check: Requirement["present"], question: string): Requirement {
  return { key, present: check, question };
}

function factPresent(key: RequestFactKey, facts: CanonicalRequestFacts): boolean {
  switch (key) {
    case "location": return locationPresent(facts);
    case "requested_date": return present(facts.requestedDate);
    case "requested_window": return present(facts.requestedWindow);
    case "deadline": return present(facts.deadlineDate);
    case "service_details": return present(facts.serviceDetails);
    case "dog_size_or_breed": return present(facts.dog?.size) || present(facts.dog?.breed);
    case "vehicle_details": return present(facts.vehicleDetails);
    case "origin": return present(facts.origin);
    case "destination": return present(facts.destination);
  }
}

/** Chooses exactly one highest-priority clarification and never executes work. */
export function evaluateRequestCompleteness(input: {
  category: CanonicalServiceCategory;
  facts: CanonicalRequestFacts;
}): RequestCompletenessResult {
  const requirements = REQUIREMENTS[input.category];
  const missingRequiredFacts = requirements.filter(item => !item.present(input.facts)).map(item => item.key);
  const missingOptionalFacts = (OPTIONAL[input.category] ?? []).filter(key => !factPresent(key, input.facts));
  const next = requirements.find(item => !item.present(input.facts)) ?? null;
  return {
    status: next ? "needs_clarification" : "complete_for_job_card",
    category: input.category,
    missingRequiredFacts,
    missingOptionalFacts,
    nextQuestionKey: next?.key ?? null,
    nextQuestion: next?.question ?? null,
    mayCreateJobCard: !next,
    maySourceVendor: false,
    mayBook: false,
  };
}
