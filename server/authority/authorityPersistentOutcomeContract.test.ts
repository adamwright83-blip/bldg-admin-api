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
  });

  it("binds win and paid-order bridges to existing authority rather than caller claims", () => {
    const bridge = source("server/persistentOperator/fieldEventBridge.ts");
    expect(bridge).toContain("admitCompletedCommercialVisit");
    expect(bridge).toContain("Account win event is not bound to its Authority Receipt");
    expect(bridge).toContain("payment_evidence_mismatch");
    expect(bridge).toContain("payment_authority_missing");
    expect(bridge).toContain("authorityReceiptId: paymentAuthority.id");
  });
});
