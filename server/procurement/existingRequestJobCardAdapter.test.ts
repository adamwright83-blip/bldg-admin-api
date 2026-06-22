import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptResidentAgentPlanToJobCards,
  adaptResidentCoordinatedRequestToJobCard,
  adaptServiceRequestToJobCard,
} from "./existingRequestJobCardAdapter";

const CREATED = new Date("2026-06-21T12:00:00Z");

describe("existing request job-card adapter", () => {
  it("adapts service_requests and safely joins existing resident context", () => {
    const result = adaptServiceRequestToJobCard({
      record: {
        id: 7, bldgUserId: 42, serviceType: "grooming", status: "pending_provider_confirmation",
        requestSummary: "Theo grooming Friday", scheduledDate: "2026-06-26", scheduledWindow: null,
        requestJson: { dogName: "Theo", dogSize: "medium", notes: "Anxious around loud dryers",
          parentPlanId: "3", confidence: 0.9 }, createdAt: CREATED,
      },
      residentContext: { bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A" },
    });
    expect(result).toMatchObject({
      sourceRecordType: "service_request", sourceRecordId: "7",
      sourceRecordStatus: "pending_provider_confirmation", parentPlanId: "3",
      persistenceGapDetected: false, stateMutated: false,
    });
    expect(result.jobCards).toHaveLength(1);
    expect(result.jobCards[0]).toMatchObject({
      status: "job_card_ready_for_admin_review", category: "dog_grooming",
      residentContext: { bldgUserId: "42", buildingSlug: "the-waverly", unit: "4A" },
      requestFacts: { requestedDate: "2026-06-26", dog: { name: "Theo", size: "medium" } },
      booked: false, providerAccepted: false, stateMutated: false,
    });
  });

  it("adapts resident_coordinated_requests using direct fields and rawJson.input", () => {
    const result = adaptResidentCoordinatedRequestToJobCard({ record: {
      id: 19, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      serviceCategory: "dog_grooming", serviceRequested: "Can you get Theo groomed Friday?",
      requestedDate: "2026-06-26", requestedWindow: null, deadlineDate: null, deadlineReason: null,
      origin: null, destination: null, notes: "Needs a calm introduction", status: "pending_operator_review",
      sourceConversationId: "conversation-1", sourceSessionId: "session-1", parentPlanId: 3,
      rawJson: { input: { dogName: "Theo", dogBreed: "spaniel mix", dogTemperament: "anxious", confidence: 0.9 } },
      createdAt: CREATED,
    } });
    expect(result).toMatchObject({
      sourceRecordType: "resident_coordinated_request", sourceRecordId: "19", parentPlanId: "3",
      jobCards: [{ status: "job_card_ready_for_admin_review", category: "dog_grooming",
        requestFacts: { dog: { name: "Theo", breed: "spaniel mix", temperament: "anxious" } },
        source: { sourceType: "coordinated_request", conversationId: "conversation-1", sessionId: "session-1" } }],
    });
  });

  it("adapts every persisted resident-agent plan intent into a separate job card", () => {
    const result = adaptResidentAgentPlanToJobCards({ record: {
      id: 3, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      conversationId: "conversation-1", sessionId: "session-1",
      originalMessage: "Groom Theo Friday and detail my SUV Saturday.", planStatus: "pending_confirmation",
      planJson: { originalMessage: "Groom Theo Friday and detail my SUV Saturday.", intents: [
        { type: "dog_grooming", originalTextSpan: "Groom Theo Friday", requestedDate: "2026-06-26",
          dogName: "Theo", dogSize: "medium", confidence: 0.9 },
        { type: "car_detail", originalTextSpan: "detail my SUV Saturday", requestedDate: "2026-06-27",
          vehicleDetails: "SUV", confidence: 0.88 },
      ] }, createdAt: CREATED,
    } });
    expect(result.jobCards).toHaveLength(2);
    expect(result.jobCards.map(card => card.category)).toEqual(["dog_grooming", "car_detail"]);
    expect(result.jobCards.map(card => card.source.sourceId)).toEqual(["3:1", "3:2"]);
    expect(result.jobCards.every(card => !card.booked && !card.providerAccepted && !card.stateMutated)).toBe(true);
  });

  it("supports the later planJson.items shape without inferring confirmed status", () => {
    const result = adaptResidentAgentPlanToJobCards({ record: {
      id: 4, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      conversationId: null, sessionId: null, originalMessage: "Detail my SUV Saturday.", planStatus: "completed",
      planJson: { type: "multi_service_plan", items: [{ serviceCategory: "car_detail", title: "Car Detail",
        status: "confirmed", date: "2026-06-27", vehicleDetails: "SUV" }] }, createdAt: CREATED,
    } });
    expect(result.sourceRecordStatus).toBe("completed");
    expect(result.jobCards[0]).toMatchObject({ booked: false, providerAccepted: false, bookingVerified: false,
      dispatched: false, paymentAuthorized: false, completed: false });
  });

  it("fails closed on missing or malformed plan items without fabricating a card", () => {
    for (const planJson of [null, {}, "not-json", { items: [null, "bad"] }]) {
      const result = adaptResidentAgentPlanToJobCards({ record: {
        id: 5, bldgUserId: null, residentName: null, buildingSlug: null, unit: null,
        conversationId: null, sessionId: null, originalMessage: "Help", planStatus: "pending_confirmation",
        planJson, createdAt: CREATED,
      } });
      expect(result.jobCards).toEqual([]);
      expect(result.adapterReasons).toEqual(["resident_plan_items_missing_or_invalid"]);
      expect(result.stateMutated).toBe(false);
    }
  });

  it("surfaces missing historical dog facts as clarification, not a schema or truth claim", () => {
    const result = adaptResidentCoordinatedRequestToJobCard({ record: {
      id: 20, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      serviceCategory: "dog_grooming", serviceRequested: "Groom Theo Friday", requestedDate: "2026-06-26",
      requestedWindow: null, deadlineDate: null, deadlineReason: null, origin: null, destination: null,
      notes: null, status: "pending_operator_review", sourceConversationId: null, sourceSessionId: null,
      parentPlanId: null, rawJson: { input: { dogName: "Theo" } }, createdAt: CREATED,
    } });
    expect(result.persistenceGapDetected).toBe(false);
    expect(result.jobCards[0]).toMatchObject({
      status: "job_card_needs_clarification",
      completeness: { nextQuestionKey: "dog_size_or_breed", maySourceVendor: false, mayBook: false },
    });
  });

  it("is pure and contains no DB write, SQL, route, UI, worker, LLM, outreach, payment, or dispatch wiring", () => {
    const source = readFileSync("server/procurement/existingRequestJobCardAdapter.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete|invokeLLM)\s*\(/i);
    expect(source).not.toMatch(/\b(Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
    expect(source).not.toMatch(/vendor_outreach|provider_acceptance|marketplace_payment|dispatch_proof/i);
  });
});
