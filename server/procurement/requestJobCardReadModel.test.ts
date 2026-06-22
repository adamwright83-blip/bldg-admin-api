import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRequestJobCardPage, type RequestJobCardSourceRecords } from "./requestJobCardReadModel";

const at = (minute: number) => new Date(`2026-06-21T12:${String(minute).padStart(2, "0")}:00Z`);

function sources(): RequestJobCardSourceRecords {
  return {
    serviceRequests: [{
      record: { id: 1, bldgUserId: 42, serviceType: "laundry", status: "pending",
        requestSummary: "Laundry", requestJson: {}, scheduledDate: null, scheduledWindow: null, createdAt: at(1) },
      residentContext: { bldgUserId: 42, buildingSlug: "the-waverly", unit: "4A" },
    }],
    coordinatedRequests: [{
      id: 2, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      serviceCategory: "dog_grooming", serviceRequested: "Groom Theo Friday", requestedDate: "2026-06-26",
      requestedWindow: null, deadlineDate: null, deadlineReason: null, origin: null, destination: null,
      notes: null, status: "pending_operator_review", sourceConversationId: null, sourceSessionId: null,
      parentPlanId: null, rawJson: { input: { dogName: "Theo" } }, createdAt: at(3),
    }],
    residentPlans: [{
      id: 3, bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A",
      conversationId: "c1", sessionId: "s1", originalMessage: "Groom Theo and detail my SUV",
      planStatus: "pending_confirmation", planJson: { intents: [
        { type: "dog_grooming", originalTextSpan: "Groom Theo", dogSize: "medium" },
        { type: "car_detail", originalTextSpan: "detail my SUV", vehicleDetails: "SUV" },
      ] }, createdAt: at(2),
    }],
  };
}

describe("request job-card read model", () => {
  it("merges source records newest-first and preserves clarification state", () => {
    const page = buildRequestJobCardPage({ sources: sources(), limit: 20, offset: 0 });
    expect(page.items.map(item => item.sourceRecordType)).toEqual([
      "resident_coordinated_request", "resident_agent_plan", "service_request",
    ]);
    expect(page.items[0].jobCards[0]).toMatchObject({
      status: "job_card_needs_clarification",
      completeness: { nextQuestionKey: "dog_size_or_breed" },
    });
    expect(page.page).toMatchObject({ returnedSourceRecords: 3, returnedJobCards: 4, hasMore: false });
  });

  it("paginates source records with bounded limits", () => {
    const first = buildRequestJobCardPage({ sources: sources(), limit: 2, offset: 0 });
    expect(first.items).toHaveLength(2);
    expect(first.page).toMatchObject({ limit: 2, offset: 0, hasMore: true });
    const second = buildRequestJobCardPage({ sources: sources(), limit: 500, offset: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.page).toMatchObject({ limit: 50, offset: 2, hasMore: false });
  });

  it("returns diagnostics but no fabricated card for malformed plan JSON", () => {
    const value = sources();
    value.serviceRequests = [];
    value.coordinatedRequests = [];
    value.residentPlans[0].planJson = "malformed";
    const page = buildRequestJobCardPage({ sources: value, limit: 10, offset: 0 });
    expect(page.items[0].jobCards).toEqual([]);
    expect(page.items[0].adapterReasons).toEqual(["resident_plan_items_missing_or_invalid"]);
    expect(page.diagnostics.sourceRecordsWithoutCards).toBe(1);
  });

  it("does not expose raw source JSON outside derived job-card facts", () => {
    const page = buildRequestJobCardPage({ sources: sources(), limit: 10, offset: 0 });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("rawJson");
    expect(serialized).not.toContain("requestJson");
    expect(serialized).not.toContain("planJson");
  });

  it("contains no DB, route, UI, worker, LLM, or execution wiring", () => {
    const source = readFileSync("server/procurement/requestJobCardReadModel.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete|invokeLLM)\s*\(/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
    expect(source).not.toMatch(/vendor_outreach|provider_acceptance|marketplace_payment|dispatch_proof/i);
  });
});
