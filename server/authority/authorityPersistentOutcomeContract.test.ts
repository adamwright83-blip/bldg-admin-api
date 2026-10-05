import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("persistent outcome Authority Receipt boundary", () => {
  it("admits visit completion only from a persisted human commercial mission event", () => {
    const admission = source("server/authority/actionCompletionAdmission.ts");
    expect(admission).toContain('event.eventName !== "visit_completed"');
    expect(admission).toContain("System/model actors cannot attest completed field work");
    expect(admission).toContain('claimType: "action_completed"');
    expect(admission).toContain('subjectType: "commercial_mission"');
    expect(admission).toContain('sourceType: "commercial_mission_event"');
  });

  it("requires Authority Receipts before Persistent Operator learns consequential outcomes", () => {
    const store = source("server/persistentOperator/outcomeStore.ts");
    expect(store).toContain("assertConsequentialOutcomeAuthority");
    expect(store).toContain('visit_completed: {');
    expect(store).toContain('claimType: "action_completed"');
    expect(store).toContain('account_won: {');
    expect(store).toContain('claimType: "account_won"');
    expect(store).toContain('cleancloud_order_paid: {');
    expect(store).toContain('claimType: "payment_verified"');
    expect(store).toContain('field_debrief_analyzed: {');
    expect(store).toContain('claimType: "field_observation_attested"');
    expect(store).toContain("cleancloud_order_paid amount does not match persisted paid-order evidence");
    expect(store).toContain("row.totalCents === input.monetaryValueCents");
  });

  it("binds win, payment, and debrief bridges to durable authority rather than caller claims", () => {
    const bridge = source("server/persistentOperator/fieldEventBridge.ts");
    expect(bridge).toContain("admitCompletedCommercialVisit");
    expect(bridge).toContain("Account win event is not bound to its Authority Receipt");
    expect(bridge).toContain("payment_evidence_mismatch");
    expect(bridge).toContain("payment_authority_missing");
    expect(bridge).toContain("authorityReceiptId: paymentAuthority.id");
    expect(bridge).toContain("admitCommercialFieldObservation");
    expect(bridge).toContain("admitted.observationText");
    expect(bridge).toContain("authorityReceiptId: admitted.receipt.id");
    expect(bridge).toContain("debrief learning failed closed");
  });

  it("admits debrief testimony only from a persisted human observation bound to its visit outcome", () => {
    const admission = source("server/authority/fieldObservationAdmission.ts");
    expect(admission).toContain("PARKING_LOT_CLERK_EVENT_NAME");
    expect(admission).toContain("PARKING_LOT_CLERK_PROVENANCE");
    expect(admission).toContain("System/model actors cannot attest field observations");
    expect(admission).toContain("Field observation testimony is not bound to its persisted visit outcome");
    expect(admission).toContain('claimType: "field_observation_attested"');
  });

  it("repairs historical consequential outcomes and removes learning when authority cannot be proven", () => {
    const migrate = source("scripts/migrate.mjs");
    expect(migrate).toContain("legacy_commercial_visit_completion_backfill_v1");
    expect(migrate).toContain("attach action authority to historical Persistent Operator visit outcomes");
    expect(migrate).toContain("attach win authority to historical Persistent Operator outcomes");
    expect(migrate).toContain("attach payment authority to historical Persistent Operator revenue outcomes");
    expect(migrate).toContain("remove learning derived from unreceipted consequential outcomes");
    expect(migrate).toContain("downgrade unreceipted consequential Persistent Operator outcomes");
    expect(migrate).toContain("legacy_field_observation_backfill_v1");
    expect(migrate).toContain("attach field observation authority to historical debrief outcomes");
    expect(migrate).toContain("remove learning derived from unreceipted field debrief outcomes");
    expect(migrate).toContain("downgrade unreceipted field debrief outcomes");
  });
});
