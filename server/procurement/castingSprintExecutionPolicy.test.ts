import { describe, expect, it } from "vitest";
import { buildRequestJobCard, type RequestJobCard } from "./requestJobCardPolicy";
import { buildCastingMission } from "./vendorCastingSprintPolicy";
import {
  ALLOWED_TRUTH_LINES,
  buildCastingSprintOutreachDraft,
  canLogManualAttempt,
  computeDraftAttemptStatus,
  detectDemoFactsReusedAsReal,
  FOUNDER_ESCALATION_LINE,
  validateRealVendorFacts,
  type RealVendorFacts,
} from "./castingSprintExecutionPolicy";

function dogGroomingJobCard(): RequestJobCard {
  return buildRequestJobCard({
    serviceIntent: "dog_grooming",
    rawRequest: "Dog name: Butterscotch. Breed/size: Boxer / medium / 78 lbs. Temperament: friendly, no special handling needs. Budget: up to $125 before tip. Requested date: 2026-06-23. Requested window: 11:00 AM to 1:00 PM.",
    facts: {
      requestedDate: "2026-06-23",
      requestedWindow: "11:00 AM to 1:00 PM",
      dog: { name: "Butterscotch", breed: "Boxer", weight: "78 lbs", size: "medium", temperament: "friendly", handlingNotes: "no special handling needs" },
      budget: "up to $125 before tip",
    },
    residentContext: { buildingSlug: "cpe-south", unit: "4B" },
    source: { sourceType: "service_request", sourceId: "155" },
    now: new Date("2026-06-24T00:00:00.000Z"),
  });
}

function mission() {
  return buildCastingMission({ jobCard: dogGroomingJobCard(), sourceKey: "service_request:155" });
}

function winnerLead() {
  const m = mission();
  return m.lanes.flatMap(lane => lane.leads).find(lead => lead.id === m.winner!.leadId)!;
}

function realFacts(overrides?: Partial<RealVendorFacts>): RealVendorFacts {
  return {
    businessName: "Westside Mobile Pet Spa",
    phone: "555-010-2002",
    email: null,
    website: null,
    sourceType: "manual_operator_list",
    sourceReference: "Adam called and confirmed via Google Maps listing",
    serviceArea: "cpe-south",
    qualificationNotes: "Verified by Adam directly; services boxers, mobile van, available weekdays.",
    googleRating: null,
    googleReviewCount: null,
    yelpRating: null,
    yelpReviewCount: null,
    observedAt: "2026-06-24",
    negativeFlags: null,
    sourceConfidenceNotes: null,
    ...overrides,
  };
}

describe("casting sprint execution policy: real vendor fact validation", () => {
  it("requires businessName and at least one contact method", () => {
    const lead = winnerLead();
    const missingBoth = validateRealVendorFacts({ businessName: "", sourceType: "manual_operator_list", sourceReference: "x", serviceArea: "y", qualificationNotes: "0123456789" }, lead);
    expect(missingBoth.valid).toBe(false);
    expect(missingBoth.reasons).toContain("business_name_required");
    expect(missingBoth.reasons).toContain("at_least_one_contact_method_required");

    const valid = validateRealVendorFacts(realFacts(), lead);
    expect(valid.valid).toBe(true);
    expect(valid.reasons).toEqual([]);
  });

  it("does not treat demo lead fields as real evidence", () => {
    const lead = winnerLead();
    expect(lead.businessName).toMatch(/\(Demo\)/);
    const reused = detectDemoFactsReusedAsReal({ businessName: lead.businessName }, lead);
    expect(reused).toContain("demo_lead_business_name_reused_as_real");

    const withDemoLabel = validateRealVendorFacts(realFacts({ businessName: "Some Groomer (Demo)" }), lead);
    expect(withDemoLabel.valid).toBe(false);
    expect(withDemoLabel.reasons).toContain("demo_label_detected_in_business_name");
  });

  it("requires a non-trivial qualification note and a registered source type", () => {
    const lead = winnerLead();
    const result = validateRealVendorFacts(realFacts({ qualificationNotes: "short", sourceType: "not_a_real_type" as never }), lead);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("qualification_notes_required");
    expect(result.reasons).toContain("source_type_required");
  });
});

describe("casting sprint execution policy: outreach draft generation", () => {
  it("includes the correct dog and request facts", () => {
    const jobCard = dogGroomingJobCard();
    const draft = buildCastingSprintOutreachDraft({ jobCard, lead: winnerLead(), vendorFacts: realFacts() });
    expect(draft.body).toContain("Butterscotch");
    expect(draft.body).toContain("Boxer");
    expect(draft.body).toContain("2026-06-23");
    expect(draft.body).toContain("11:00 AM to 1:00 PM");
    expect(draft.body).toContain("up to $125 before tip");
  });

  it("includes the founder escalation line verbatim", () => {
    const draft = buildCastingSprintOutreachDraft({ jobCard: dogGroomingJobCard(), lead: winnerLead(), vendorFacts: realFacts() });
    expect(draft.body).toContain(FOUNDER_ESCALATION_LINE);
    expect(draft.founderEscalationIncluded).toBe(true);
  });

  it("includes only the allowed truth lines", () => {
    const draft = buildCastingSprintOutreachDraft({ jobCard: dogGroomingJobCard(), lead: winnerLead(), vendorFacts: realFacts() });
    ALLOWED_TRUTH_LINES.forEach(line => expect(draft.body).toContain(line));
    expect(draft.truthLinesIncluded).toEqual([...ALLOWED_TRUTH_LINES]);
  });

  it("never contains a forbidden booking/confirmation/payment/acceptance claim and is marked safe to copy", () => {
    const draft = buildCastingSprintOutreachDraft({ jobCard: dogGroomingJobCard(), lead: winnerLead(), vendorFacts: realFacts() });
    expect(draft.forbiddenClaimsDetected).toEqual([]);
    expect(draft.blockingLintRules).toEqual([]);
    expect(draft.safeToCopy).toBe(true);
    expect(draft.sentByHeld).toBe(false);
    const bodyWithAllowedLinesRemoved = ALLOWED_TRUTH_LINES.reduce((text, line) => text.split(line).join(""), draft.body).toLowerCase();
    const forbidden = ["booked", "confirmed", "accepted", "scheduled", "paid", "payment ready", "dispatch", "completed", "provider accepted", "resident booked"];
    forbidden.forEach(claim => expect(bodyWithAllowedLinesRemoved).not.toContain(claim));
  });
});

describe("casting sprint execution policy: attempt status and manual logging", () => {
  it("stays blocked until a draft has been generated", () => {
    expect(computeDraftAttemptStatus({ draftGenerated: false, channel: null, copied: false, manuallySent: false })).toBe("blocked");
  });

  it("progresses draft_ready -> copied -> response_pending without ever claiming a real response", () => {
    expect(computeDraftAttemptStatus({ draftGenerated: true, channel: null, copied: false, manuallySent: false })).toBe("draft_ready");
    expect(computeDraftAttemptStatus({ draftGenerated: true, channel: "email", copied: true, manuallySent: false })).toBe("copied");
    expect(computeDraftAttemptStatus({ draftGenerated: true, channel: "email", copied: true, manuallySent: true })).toBe("response_pending");
  });

  it("requires a draft and a channel before a manual attempt can be logged", () => {
    expect(canLogManualAttempt({ draftGenerated: false, channel: null })).toMatchObject({ allowed: false });
    expect(canLogManualAttempt({ draftGenerated: true, channel: null })).toMatchObject({ allowed: false, reasons: ["contact_channel_required"] });
    expect(canLogManualAttempt({ draftGenerated: true, channel: "call" })).toMatchObject({ allowed: true, reasons: [] });
  });
});
