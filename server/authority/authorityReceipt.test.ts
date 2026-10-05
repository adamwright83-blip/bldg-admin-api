import { describe, expect, it } from "vitest";
import {
  assertAuthorityClaimPolicy,
  authorityReceiptIdempotencyKey,
} from "./authorityReceipt";

const base = {
  tenantId: "tenant-1",
  subjectType: "order",
  subjectId: "42",
  sourceType: "stripe_payment_intent",
  sourceRef: "pi_123",
  actorType: "system",
  actorId: null,
  admissionPolicy: "test",
} as const;

describe("authority receipt policy", () => {
  it("requires external VERIFIED evidence for payment", () => {
    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "payment_verified",
        evidenceClass: "operator_attested",
        verificationClass: "ATTESTED",
      })
    ).toThrow(/payment_verified/);

    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "payment_verified",
        evidenceClass: "authoritative_external",
        verificationClass: "VERIFIED",
      })
    ).not.toThrow();
  });

  it("allows an explicit operator-attested win but not a system attestation", () => {
    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "account_won",
        subjectType: "commercial_mission",
        sourceType: "commercial_mission_transition",
        evidenceClass: "operator_attested",
        verificationClass: "ATTESTED",
        actorType: "operator",
      })
    ).not.toThrow();

    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "account_won",
        subjectType: "commercial_mission",
        sourceType: "commercial_mission_transition",
        evidenceClass: "operator_attested",
        verificationClass: "ATTESTED",
        actorType: "system",
      })
    ).toThrow(/operator attestation/);
  });

  it("requires Twilio VERIFIED provider evidence for message_sent", () => {
    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "message_sent",
        subjectType: "message",
        sourceType: "internal_tool",
        evidenceClass: "authoritative_external",
        verificationClass: "VERIFIED",
      })
    ).toThrow(/Twilio provider evidence/);

    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "message_sent",
        subjectType: "message",
        sourceType: "twilio_message",
        evidenceClass: "authoritative_external",
        verificationClass: "VERIFIED",
      })
    ).not.toThrow();
  });

  it("allows human-attested persisted visit completion but not system claims", () => {
    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "action_completed",
        subjectType: "commercial_mission",
        subjectId: "77",
        sourceType: "commercial_mission_event",
        sourceRef: "commercial_mission_events:901",
        evidenceClass: "operator_attested",
        verificationClass: "ATTESTED",
        actorType: "driver",
      })
    ).not.toThrow();

    expect(() =>
      assertAuthorityClaimPolicy({
        ...base,
        claimType: "action_completed",
        subjectType: "commercial_mission",
        subjectId: "77",
        sourceType: "commercial_mission_event",
        sourceRef: "commercial_mission_events:901",
        evidenceClass: "operator_attested",
        verificationClass: "ATTESTED",
        actorType: "system",
      })
    ).toThrow(/human-attested/);
  });

  it("keeps idempotency on the semantic claim and source identity", () => {
    const first = authorityReceiptIdempotencyKey({
      claimType: "payment_verified",
      subjectType: "order",
      subjectId: "42",
      sourceType: "stripe_payment_intent",
      sourceRef: "pi_123",
    });
    const retry = authorityReceiptIdempotencyKey({
      claimType: "payment_verified",
      subjectType: "order",
      subjectId: "42",
      sourceType: "stripe_payment_intent",
      sourceRef: "pi_123",
    });
    const otherPayment = authorityReceiptIdempotencyKey({
      claimType: "payment_verified",
      subjectType: "order",
      subjectId: "42",
      sourceType: "stripe_payment_intent",
      sourceRef: "pi_456",
    });
    expect(retry).toBe(first);
    expect(otherPayment).not.toBe(first);
  });
});
