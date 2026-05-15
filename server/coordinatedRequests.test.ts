import { describe, expect, it } from "vitest";
import {
  coordinatedRequestServiceLabel,
  mapLegacyServiceRequestForRequestsPage,
  mapResidentCoordinatedRequestForRequestsPage,
  mergeCoordinatedRequestsForRequestsPage,
} from "./db";

function legacyRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    bldgUserId: 42,
    serviceType: "grooming",
    status: "new",
    requestSummary: "Legacy grooming request",
    requestJson: {},
    scheduledDate: null,
    scheduledWindow: null,
    scheduledStartUtc: null,
    scheduledEndUtc: null,
    scheduledStartLocal: null,
    scheduledEndLocal: null,
    timezone: null,
    upgradeCode: null,
    upgradePriceCents: null,
    upgradeLabel: null,
    paymentAdjustmentDueCents: null,
    createdAt: new Date("2026-05-14T10:00:00Z"),
    updatedAt: new Date("2026-05-14T10:00:00Z"),
    receiptUrl: null,
    orderId: null,
    ...overrides,
  } as any;
}

function residentRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    tenantId: "default",
    bldgUserId: 42,
    residentName: "Ada Lovelace",
    residentPhone: "+13235550123",
    residentEmail: "ada@example.com",
    buildingSlug: "opus-la",
    buildingName: "Opus LA",
    unit: "1201",
    serviceCategory: "dog_grooming",
    serviceRequested: "Dog groomer before guest arrives",
    requestedDate: null,
    requestedWindow: null,
    deadlineDate: "2026-05-18",
    deadlineReason: "mother-in-law visit",
    origin: null,
    destination: null,
    notes: "Small dog",
    status: "pending_operator_review",
    statusReason: "Created by resident agent",
    residentVisibleStatus: "pending_operator_review",
    nextAction: "Operator review required",
    requiresHumanApproval: true,
    customerCharged: false,
    providerVendorId: null,
    providerConfirmationStatus: null,
    sourceConversationId: "conv_1",
    sourceSessionId: "sess_1",
    parentPlanId: 900,
    rawJson: null,
    createdAt: new Date("2026-05-15T10:00:00Z"),
    updatedAt: new Date("2026-05-15T10:00:00Z"),
    ...overrides,
  } as any;
}

describe("coordinated Requests page rows", () => {
  it("keeps legacy service_requests visible without requiring a bldg_users join", () => {
    const row = mapLegacyServiceRequestForRequestsPage(legacyRequest({
      serviceType: "car-wash",
      requestSummary: "Legacy car wash",
      requestJson: {
        residentName: "Grace Hopper",
        residentPhone: "+13105550199",
        buildingSlug: "opus-la",
        unit: "904",
      },
    }));

    expect(row).toMatchObject({
      source: "service_requests",
      serviceCategory: "car-wash",
      serviceLabel: "Car Detail",
      residentName: "Grace Hopper",
      residentPhone: "+13105550199",
      buildingSlug: "opus-la",
      unit: "904",
      serviceRequested: "Legacy car wash",
    });
  });

  it("uses resident_coordinated_requests denormalized identity fields", () => {
    const row = mapResidentCoordinatedRequestForRequestsPage(residentRequest());

    expect(row).toMatchObject({
      source: "resident_coordinated_requests",
      serviceCategory: "dog_grooming",
      serviceLabel: "Dog Grooming",
      residentName: "Ada Lovelace",
      residentPhone: "+13235550123",
      residentEmail: "ada@example.com",
      buildingName: "Opus LA",
      unit: "1201",
      deadlineDate: "2026-05-18",
      deadlineReason: "mother-in-law visit",
      parentPlanId: 900,
    });
  });

  it("maps resident categories to clear service labels", () => {
    expect(coordinatedRequestServiceLabel("dog_grooming")).toBe("Dog Grooming");
    expect(coordinatedRequestServiceLabel("car_detail")).toBe("Car Detail");
    expect(coordinatedRequestServiceLabel("airport_transport")).toBe("LAX / Airport Pickup");
    expect(coordinatedRequestServiceLabel("apartment_cleaning")).toBe("Apartment Cleaning");
    expect(coordinatedRequestServiceLabel("dry_cleaning")).toBe("Dry Cleaning");
    expect(coordinatedRequestServiceLabel("other")).toBe("Other");
  });

  it("maps legacy categories to clear service labels", () => {
    expect(coordinatedRequestServiceLabel("grooming")).toBe("Dog Grooming");
    expect(coordinatedRequestServiceLabel("car-wash")).toBe("Car Detail");
    expect(coordinatedRequestServiceLabel("other")).toBe("Other");
  });

  it("includes legacy and resident rows sorted newest first", () => {
    const rows = mergeCoordinatedRequestsForRequestsPage(
      [legacyRequest({ id: 1, createdAt: new Date("2026-05-14T10:00:00Z") })],
      [
        residentRequest({
          id: 2,
          serviceCategory: "car_detail",
          serviceRequested: "Car detail",
          requestedWindow: "morning",
          createdAt: new Date("2026-05-15T09:00:00Z"),
        }),
        residentRequest({
          id: 3,
          serviceCategory: "airport_transport",
          serviceRequested: "LAX pickup",
          origin: "LAX",
          destination: "Opus LA",
          createdAt: new Date("2026-05-15T11:00:00Z"),
        }),
      ]
    );

    expect(rows.map((row) => `${row.source}:${row.id}`)).toEqual([
      "resident_coordinated_requests:3",
      "resident_coordinated_requests:2",
      "service_requests:1",
    ]);
    expect(rows[0]).toMatchObject({
      serviceLabel: "LAX / Airport Pickup",
      origin: "LAX",
      destination: "Opus LA",
    });
    expect(rows[1]).toMatchObject({
      serviceLabel: "Car Detail",
      requestedWindow: "morning",
    });
  });
});
