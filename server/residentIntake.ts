import type { InsertOrder, Order } from "../drizzle/schema";
import { BUILDINGS } from "@shared/buildings";
import { normalizePhoneForStorage } from "./phone";

type IntakeStatus = Extract<Order["status"], "new" | "intake-pending">;

export type BuiltBldgIntakeOrder = {
  order: InsertOrder;
  status: IntakeStatus;
  needsReview: boolean;
  needsReviewReason: string | null;
  /** Resident-app idempotency key (per "set it in motion" tap). Stored in
   * heldMetadataJson.clientRequestId so a retry resolves to the same order. */
  clientRequestId: string | null;
  paymentInput: {
    stripeCustomerId: string | null;
    stripePaymentMethodId: string | null;
  };
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function exactText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
}

function firstExactText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = exactText(value);
    if (found) return found;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function splitResidentName(input: {
  firstName?: unknown;
  lastName?: unknown;
  name?: unknown;
}): { firstName: string | null; lastName: string | null } {
  const firstName = text(input.firstName);
  const lastName = text(input.lastName);
  if (firstName && lastName) return { firstName, lastName };

  const fullName = text(input.name);
  if (!fullName) {
    return {
      firstName,
      lastName,
    };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: firstName ?? parts[0] ?? null,
    lastName: lastName ?? (parts.slice(1).join(" ") || "Resident"),
  };
}

function ymdFromDateLike(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return match[1];
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function canonicalBuildingSlug(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  const building = BUILDINGS.find((candidate) => {
    const aliases = [candidate.id, candidate.slug, ...candidate.slugAliases];
    return aliases.some((alias) => alias.toLowerCase() === normalized);
  });
  return building?.slug ?? normalized;
}

function normalizeServiceType(body: Record<string, unknown>, service: Record<string, unknown>): InsertOrder["serviceType"] | null {
  const items = Array.isArray(service.items) ? service.items.map((item) => String(item)) : [];
  const raw = firstText(service.type, body.serviceType, body.service_type, items[0]);
  const normalized = raw?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  if (!normalized || normalized === "laundry" || normalized === "wash_and_fold" || normalized === "wash_fold") {
    return "wash_fold";
  }
  if (normalized === "dry_cleaning" || normalized === "dry_clean" || normalized === "drycleaning") {
    return "dry_cleaning";
  }
  if (items.some((item) => item.toLowerCase().replace(/[\s-]+/g, "_") === "dry_cleaning")) {
    return "dry_cleaning";
  }
  return null;
}

function metadataForHeld(
  held: Record<string, unknown>,
  service: Record<string, unknown>,
  source: string | null,
  clientRequestId: string | null,
): Record<string, unknown> | null {
  const rawMetadata = objectValue(held.metadata);
  const metadata: Record<string, unknown> = {
    ...rawMetadata,
  };
  if (held.confidence != null) metadata.confidence = held.confidence;
  if (held.displayRequest != null) metadata.displayRequest = held.displayRequest;
  if (service.items != null) metadata.serviceItems = service.items;
  if (source) metadata.source = source;
  // Idempotency key: persist so findResidentOrderByClientRequestId can resolve
  // a retry/double-tap back to this exact order instead of creating a duplicate.
  if (clientRequestId) metadata.clientRequestId = clientRequestId;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function buildBldgIntakeOrder(bodyValue: unknown, tenantId: string): BuiltBldgIntakeOrder {
  const body = objectValue(bodyValue);
  const resident = objectValue(body.resident);
  const service = objectValue(body.service);
  const held = objectValue(body.held);
  const payment = objectValue(body.payment);

  // Resident-app idempotency key (top-level on the intake body; may also arrive
  // nested under held). Exact-text so the opaque key is preserved verbatim.
  const clientRequestId = firstExactText(body.clientRequestId, held.clientRequestId);

  const serviceType = normalizeServiceType(body, service);
  if (!serviceType) {
    throw new Error("serviceType must be wash-fold, dry-cleaning, or laundry");
  }

  const names = splitResidentName({
    firstName: firstText(body.firstName, resident.firstName),
    lastName: firstText(body.lastName, resident.lastName),
    name: firstText(body.residentName, resident.name),
  });
  if (!names.firstName || !names.lastName) {
    throw new Error("resident name is required");
  }

  const phone = normalizePhoneForStorage(firstText(body.phone, resident.phone));
  if (!phone) {
    throw new Error("resident phone is required");
  }

  const unit = firstText(body.unit, resident.unit);
  const address = firstText(body.address, resident.address, service.address) ?? "";
  const buildingSlug = canonicalBuildingSlug(firstText(body.buildingSlug, body.buildingId, resident.buildingSlug, resident.buildingId));
  if (!address && !buildingSlug) {
    throw new Error("Either address or buildingSlug is required");
  }

  const rawRequestText = firstExactText(
    held.rawRequestText,
    held.rawRequest,
    body.rawRequestText,
    body.rawRequest
  );
  const cleanedRequestText = firstExactText(
    held.cleanedRequestText,
    held.displayRequest,
    body.cleanedRequestText,
    body.cleanedRequest
  );
  const pickupLanguage = firstExactText(
    held.pickupLanguage,
    held.requestedPickupWindow,
    service.pickupLanguage,
    service.pickupWindow,
    service.requestedTiming,
    body.heldRequestedPickupWindow,
    body.requestedTiming,
    body.pickupWindow
  );
  const returnByLanguage = firstExactText(
    held.returnByLanguage,
    held.requestedReturnBy,
    service.returnByLanguage,
    service.returnBy,
    service.deadline,
    service.deadlineDate,
    body.heldRequestedReturnBy,
    body.returnBy,
    body.deadlineDate,
    body.deliveryDate
  );
  const heldSource = firstText(held.source, body.source) ?? (rawRequestText || cleanedRequestText ? "resident_app" : null);
  const serviceSummary = firstExactText(
    held.displayRequest,
    held.serviceSummary,
    body.heldServiceSummary,
    service.notes,
    cleanedRequestText,
    rawRequestText
  );

  const pickupDate = ymdFromDateLike(firstText(service.pickupDate, service.requestedDate, body.pickupDate, body.requestedDate));
  const pickupWindow = firstText(service.pickupWindow, service.requestedWindow, body.pickupWindow, body.requestedWindow);
  const returnByDate = ymdFromDateLike(firstText(service.returnBy, service.deadlineDate, body.returnBy, body.deadlineDate, body.deliveryDate));
  const deliveryWindow = firstText(service.returnWindow, service.deliveryWindow, body.deliveryTimeWindow);
  const actionable = !!pickupDate && !!pickupWindow && !!returnByDate;
  const status: IntakeStatus = actionable ? "new" : "intake-pending";
  const needsReviewReason = actionable ? null : "Structured pickup date/window and return-by are required before scheduling.";

  const notes = firstText(body.specialInstructions, service.notes);
  const specialInstructions = [
    notes,
    cleanedRequestText ? `HELD cleaned request: ${cleanedRequestText}` : null,
    rawRequestText ? `HELD raw request: ${rawRequestText}` : null,
    pickupLanguage ? `HELD pickup: ${pickupLanguage}` : null,
    returnByLanguage ? `HELD return-by: ${returnByLanguage}` : null,
  ].filter(Boolean).join("\n") || null;

  const stripeCustomerId = firstText(payment.stripeCustomerId, body.stripeCustomerId);
  const stripePaymentMethodId = firstText(payment.stripePaymentMethodId, body.stripePaymentMethodId);

  return {
    status,
    needsReview: status === "intake-pending",
    needsReviewReason,
    clientRequestId,
    paymentInput: {
      stripeCustomerId,
      stripePaymentMethodId,
    },
    order: {
      tenantId,
      serviceType,
      pickupDate: pickupDate ?? "TBD",
      pickupTimeWindow: pickupWindow ?? pickupLanguage ?? "Needs scheduling",
      deliveryDate: returnByDate ?? (actionable && pickupDate ? addDaysYmd(pickupDate, 1) : null),
      deliveryTimeWindow: deliveryWindow ?? returnByLanguage ?? (actionable ? pickupWindow : null),
      address,
      unit,
      specialInstructions,
      heldRawRequestText: rawRequestText,
      heldCleanedRequestText: cleanedRequestText,
      heldServiceSummary: serviceSummary,
      heldRequestedPickupWindow: pickupLanguage,
      heldRequestedReturnBy: returnByLanguage,
      heldSource,
      heldMetadataJson: metadataForHeld(held, service, heldSource, clientRequestId),
      // Physical idempotency column (UNIQUE) — the atomic exact-once key.
      // heldMetadataJson.clientRequestId above is a debugging mirror only.
      residentClientRequestId: clientRequestId,
      firstName: names.firstName,
      lastName: names.lastName,
      phone,
      email: firstText(body.email, resident.email),
      stripeCustomerId,
      stripePaymentMethodId,
      bldgUserId: numberOrNull(body.bldgUserId ?? resident.bldgUserId),
      buildingSlug,
      status,
    },
  };
}
