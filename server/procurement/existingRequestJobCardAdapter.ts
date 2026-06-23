import type { ResidentAgentPlan, ResidentCoordinatedRequest, ServiceRequest } from "../../drizzle/schema";
import { buildRequestJobCard, type RequestJobCard } from "./requestJobCardPolicy";
import type { CanonicalRequestFacts } from "./requestCompletenessPolicy";

export type JoinedResidentContext = {
  bldgUserId?: string | number | null;
  residentName?: string | null;
  buildingSlug?: string | null;
  address?: string | null;
  unit?: string | null;
};

export type ExistingRequestJobCardAdapterResult = {
  sourceRecordType: "service_request" | "resident_coordinated_request" | "resident_agent_plan";
  sourceRecordId: string;
  sourceRecordStatus: string | null;
  parentPlanId: string | null;
  jobCards: RequestJobCard[];
  adapterReasons: string[];
  persistenceGapDetected: false;
  stateMutated: false;
};

type ServiceRequestRecord = Pick<ServiceRequest,
  "id" | "bldgUserId" | "serviceType" | "status" | "requestSummary" | "requestJson"
  | "scheduledDate" | "scheduledWindow" | "createdAt">;

type CoordinatedRequestRecord = Pick<ResidentCoordinatedRequest,
  "id" | "bldgUserId" | "residentName" | "buildingSlug" | "unit" | "serviceCategory"
  | "serviceRequested" | "requestedDate" | "requestedWindow" | "deadlineDate" | "deadlineReason"
  | "origin" | "destination" | "notes" | "status" | "sourceConversationId" | "sourceSessionId"
  | "parentPlanId" | "rawJson" | "createdAt">;

type ResidentPlanRecord = Pick<ResidentAgentPlan,
  "id" | "bldgUserId" | "residentName" | "buildingSlug" | "unit" | "conversationId"
  | "sessionId" | "originalMessage" | "planStatus" | "planJson" | "createdAt">;

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]
    : [];
}

function date(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return undefined;
}

function dogFacts(...sources: Record<string, unknown>[]): CanonicalRequestFacts["dog"] {
  const dog = sources.map(source => object(source.dog)).find(value => Object.keys(value).length) ?? {};
  const value = {
    name: firstText(dog.name, ...sources.map(source => source.dogName)),
    breed: firstText(dog.breed, ...sources.map(source => source.dogBreed)),
    size: firstText(dog.size, ...sources.map(source => source.dogSize)),
    ageOrLifeStage: firstText(dog.ageOrLifeStage, dog.age, ...sources.map(source => source.dogAge)),
    temperament: firstText(dog.temperament, ...sources.map(source => source.dogTemperament)),
    handlingNotes: firstText(dog.handlingNotes, ...sources.map(source => source.dogHandlingNotes)),
    negativeConstraints: firstTextArray(dog.negativeConstraints, ...sources.map(source => source.dogNegativeConstraints)),
  };
  return Object.values(value).some(Boolean) ? value : null;
}

function firstTextArray(...values: unknown[]): string[] | null {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const found = value.map(text).filter((item): item is string => item !== null);
    if (found.length) return found;
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
}

const LABELS = [
  "dog name", "breed/size", "breed", "size", "weight", "temperament",
  "handling notes", "budget", "requested date", "requested window", "date", "window",
  "service location",
];

function freeformText(...values: unknown[]): string {
  return values.map(text).filter((value): value is string => !!value).join("\n");
}

function labeledValue(source: string, labels: readonly string[]): string | null {
  if (!source.trim()) return null;
  const labelPattern = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = new RegExp(
    `(?:^|[\\n.;])\\s*(?:${labelPattern})\\s*:\\s*([^\\n.;]*)`,
    "i",
  ).exec(source);
  return text(match?.[1]?.replace(/\s+/g, " "));
}

function normalizedDogSize(value: string | null): string | null {
  const normalized = value?.toLowerCase().trim();
  if (!normalized) return null;
  if (/\bextra\s*large\b|\bxl\b/.test(normalized)) return "extra_large";
  if (/\blarge\b/.test(normalized)) return "large";
  if (/\bmedium\b|\bmed\b/.test(normalized)) return "medium";
  if (/\bsmall\b/.test(normalized)) return "small";
  return value;
}

function dogFactsFromFreeform(source: string): CanonicalRequestFacts["dog"] {
  const breedSize = labeledValue(source, ["breed/size"]);
  const breedSizeParts = breedSize?.split("/").map(part => part.trim()).filter(Boolean) ?? [];
  const explicitSize = firstText(labeledValue(source, ["size"]), breedSizeParts.find(part =>
    /\b(small|medium|med|large|extra\s*large|xl)\b/i.test(part)));
  const value = {
    name: labeledValue(source, ["dog name"]),
    breed: firstText(labeledValue(source, ["breed"]), breedSizeParts.find(part =>
      !/\b(small|medium|med|large|extra\s*large|xl|\d+\s*(lb|lbs|ibs|pounds?))\b/i.test(part))),
    weight: firstText(labeledValue(source, ["weight"]), breedSizeParts.find(part => /\d+\s*(lb|lbs|ibs|pounds?)/i.test(part))),
    size: normalizedDogSize(explicitSize),
    temperament: labeledValue(source, ["temperament"]),
    handlingNotes: labeledValue(source, ["handling notes"]),
    negativeConstraints: null,
  };
  if (!value.handlingNotes && value.temperament && /no special handling needs/i.test(value.temperament)) {
    value.handlingNotes = "no special handling needs";
  }
  return Object.values(value).some(Boolean) ? value : null;
}

function mergedDogFacts(...dogs: Array<CanonicalRequestFacts["dog"]>): CanonicalRequestFacts["dog"] {
  const found = dogs.filter((dog): dog is NonNullable<CanonicalRequestFacts["dog"]> => !!dog);
  if (!found.length) return null;
  return {
    name: firstText(...found.map(dog => dog.name)),
    breed: firstText(...found.map(dog => dog.breed)),
    weight: firstText(...found.map(dog => dog.weight)),
    size: firstText(...found.map(dog => dog.size)),
    ageOrLifeStage: firstText(...found.map(dog => dog.ageOrLifeStage)),
    temperament: firstText(...found.map(dog => dog.temperament)),
    handlingNotes: firstText(...found.map(dog => dog.handlingNotes)),
    negativeConstraints: found.find(dog => dog.negativeConstraints?.length)?.negativeConstraints ?? null,
  };
}

function mergedResident(record: JoinedResidentContext, fallback: JoinedResidentContext = {}) {
  return {
    bldgUserId: record.bldgUserId ?? fallback.bldgUserId ?? null,
    residentName: text(record.residentName) ?? text(fallback.residentName),
    buildingSlug: text(record.buildingSlug) ?? text(fallback.buildingSlug),
    address: text(record.address) ?? text(fallback.address),
    unit: text(record.unit) ?? text(fallback.unit),
  };
}

/** Adapts an existing service_requests row without reading or writing the database. */
export function adaptServiceRequestToJobCard(input: {
  record: ServiceRequestRecord;
  residentContext?: JoinedResidentContext;
}): ExistingRequestJobCardAdapterResult {
  const record = input.record;
  const json = object(record.requestJson);
  const freeform = freeformText(json.notes, json.serviceDetails, json.rawRequest, json.originalMessage, record.requestSummary);
  const freeformDog = dogFactsFromFreeform(freeform);
  const resident = mergedResident(input.residentContext ?? {}, { bldgUserId: record.bldgUserId });
  const facts: CanonicalRequestFacts = {
    buildingSlug: resident.buildingSlug,
    address: resident.address,
    unit: resident.unit,
    requestedDate: firstText(record.scheduledDate, json.requestedDate, json.date, labeledValue(freeform, ["requested date", "date"])),
    requestedWindow: firstText(record.scheduledWindow, json.requestedWindow, json.window, labeledValue(freeform, ["requested window", "window"])),
    deadlineDate: firstText(json.deadlineDate, json.returnByDate),
    serviceDetails: firstText(json.serviceDetails, json.notes, record.requestSummary),
    vehicleDetails: firstText(json.vehicleDetails, json.vehicle),
    origin: firstText(json.origin),
    destination: firstText(json.destination),
    dog: mergedDogFacts(dogFacts(json), freeformDog),
    budget: labeledValue(freeform, ["budget"]),
  };
  const sourceId = String(record.id);
  const card = buildRequestJobCard({
    serviceIntent: firstText(json.serviceCategory, record.serviceType),
    rawRequest: firstText(json.rawRequest, json.originalMessage, record.requestSummary),
    displaySummary: record.requestSummary,
    residentContext: resident,
    facts,
    source: {
      sourceType: "service_request", sourceId,
      conversationId: json.sourceConversationId, sessionId: json.sourceSessionId,
    },
    classificationConfidence: json.confidence,
    now: date(record.createdAt),
  });
  return result("service_request", sourceId, record.status, firstText(json.parentPlanId), [card]);
}

/** Adapts the newer resident_coordinated_requests shape and its existing rawJson.input evidence. */
export function adaptResidentCoordinatedRequestToJobCard(input: {
  record: CoordinatedRequestRecord;
}): ExistingRequestJobCardAdapterResult {
  const record = input.record;
  const raw = object(record.rawJson);
  const rawInput = object(raw.input);
  const resident = mergedResident({
    bldgUserId: record.bldgUserId, residentName: record.residentName,
    buildingSlug: record.buildingSlug, unit: record.unit,
  });
  const facts: CanonicalRequestFacts = {
    buildingSlug: resident.buildingSlug,
    address: firstText(rawInput.address),
    unit: resident.unit,
    requestedDate: firstText(record.requestedDate, rawInput.requestedDate),
    requestedWindow: firstText(record.requestedWindow, rawInput.requestedWindow),
    deadlineDate: firstText(record.deadlineDate, rawInput.deadlineDate),
    serviceDetails: firstText(record.notes, rawInput.serviceDetails, rawInput.notes, record.serviceRequested),
    vehicleDetails: firstText(rawInput.vehicleDetails, rawInput.vehicle),
    origin: firstText(record.origin, rawInput.origin),
    destination: firstText(record.destination, rawInput.destination),
    dog: dogFacts(rawInput, raw),
  };
  const sourceId = String(record.id);
  const card = buildRequestJobCard({
    serviceIntent: record.serviceCategory,
    rawRequest: record.serviceRequested,
    displaySummary: record.serviceRequested,
    residentContext: resident,
    facts,
    source: {
      sourceType: "coordinated_request", sourceId,
      conversationId: record.sourceConversationId, sessionId: record.sourceSessionId,
    },
    classificationConfidence: rawInput.confidence,
    now: date(record.createdAt),
  });
  return result("resident_coordinated_request", sourceId, record.status,
    text(record.parentPlanId), [card]);
}

/**
 * A parent plan can contain several intents/items, so adaptation returns one
 * job card per persisted child description. It never creates child records.
 */
export function adaptResidentAgentPlanToJobCards(input: {
  record: ResidentPlanRecord;
}): ExistingRequestJobCardAdapterResult {
  const record = input.record;
  const plan = object(record.planJson);
  const entries = array(plan.items).length ? array(plan.items) : array(plan.intents);
  const sourceId = String(record.id);
  if (!entries.length) {
    return {
      ...result("resident_agent_plan", sourceId, record.planStatus, sourceId, []),
      adapterReasons: ["resident_plan_items_missing_or_invalid"],
    };
  }
  const resident = mergedResident({
    bldgUserId: record.bldgUserId, residentName: record.residentName,
    buildingSlug: record.buildingSlug, unit: record.unit,
  });
  const cards = entries.map((entry, index) => {
    const facts: CanonicalRequestFacts = {
      buildingSlug: resident.buildingSlug,
      address: firstText(entry.address),
      unit: resident.unit,
      requestedDate: firstText(entry.requestedDate, entry.date),
      requestedWindow: firstText(entry.requestedWindow, entry.window),
      deadlineDate: firstText(entry.deadlineDate),
      serviceDetails: firstText(entry.serviceDetails, entry.notes, entry.originalTextSpan, entry.title),
      vehicleDetails: firstText(entry.vehicleDetails, entry.vehicle),
      origin: firstText(entry.origin),
      destination: firstText(entry.destination),
      dog: dogFacts(entry),
    };
    return buildRequestJobCard({
      serviceIntent: firstText(entry.serviceCategory, entry.type),
      rawRequest: firstText(entry.originalTextSpan, plan.originalMessage, record.originalMessage),
      displaySummary: firstText(entry.title, entry.originalTextSpan, record.originalMessage),
      residentContext: resident,
      facts,
      source: {
        sourceType: "resident_agent_plan", sourceId: `${sourceId}:${index + 1}`,
        conversationId: record.conversationId, sessionId: record.sessionId,
      },
      classificationConfidence: entry.confidence,
      now: date(record.createdAt),
    });
  });
  return result("resident_agent_plan", sourceId, record.planStatus, sourceId, cards);
}

function result(
  sourceRecordType: ExistingRequestJobCardAdapterResult["sourceRecordType"],
  sourceRecordId: string,
  sourceRecordStatus: unknown,
  parentPlanId: string | null,
  jobCards: RequestJobCard[],
): ExistingRequestJobCardAdapterResult {
  return {
    sourceRecordType, sourceRecordId, sourceRecordStatus: text(sourceRecordStatus), parentPlanId,
    jobCards, adapterReasons: [], persistenceGapDetected: false, stateMutated: false,
  };
}
